/**
 * Surffish-only PIN / Touch ID quick unlock for Bramble, layered on the unmodified extension.
 *
 * Bramble upstream will not add a PIN (flythenimbus/bramble#88) and its own Touch ID slot is a
 * WebAuthn credential that Electron cannot create. So Surffish keeps the master password itself,
 * encrypted in this process (bramble-quick-unlock-crypto.ts / -vault.ts), and when Bramble's popup
 * shows its master-password unlock form, draws its own PIN pad over the popup. A correct PIN (or
 * Touch ID) decrypts the master password here, and Surffish types it into Bramble's form and
 * submits it, exactly as if the user had typed it. Bramble's code and crypto are never touched.
 *
 * Only one unlock screen is ever in front: Surffish's PIN pad while quick unlock is armed, or
 * Bramble's own form otherwise ("Use master password" on the pad, or not armed). Surffish has no
 * master password screen of its own. In memory-only mode after a restart the user unlocks with
 * Bramble's own form, and Surffish watches that form (from the same isolated world it fills it
 * from) for the master password it was given; if it opens the re-arm slot, the PIN is back on.
 *
 * Loaded lazily (first Settings call, or a Bramble popup opening while bramble-quick-unlock.json
 * exists), so a profile that never enables it pays nothing at startup.
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  systemPreferences,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAMBLE_VAULT_PROBE_SCRIPT,
  buildUnlockFillScript,
  MASTER_CAPTURE_INSTALL_SCRIPT,
  MASTER_CAPTURE_STOP_SCRIPT,
  MASTER_CAPTURE_TAKE_SCRIPT,
  classifyBrambleVaultProbe,
  classifyBrambleUnlockScreen,
  classifyFillOutcome,
  quickUnlockSetupBlocker,
  UNLOCK_SNAPSHOT_SCRIPT,
  type BrambleQuickUnlockEnrolInput,
  type BrambleVaultStatus,
  type BrambleQuickUnlockState,
  type QuickUnlockResult,
} from "../shared/bramble-quick-unlock";
import {
  BrambleQuickUnlockVault,
  MASTER_CHANGED_NOTICE,
  type DeviceKeyProtector,
  type QuickUnlockPersistence,
} from "./bramble-quick-unlock-vault";
import { QUICK_UNLOCK_OVERLAY_HTML } from "./bramble-quick-unlock-overlay";
import { writeJsonAtomic } from "./extension-staging";
import { sendToMainWindowRenderers } from "./browser-shell";
import { evaluateInBrambleExtensionPage } from "./bramble-poc";

export const QUICK_UNLOCK_CONFIG_FILE = "bramble-quick-unlock.json";
/** Isolated world Surffish reads/fills Bramble's unlock form from (never Bramble's own world). */
const ISOLATED_WORLD_ID = 1977;
const DETECT_INTERVAL_MS = 350;
const OUTCOME_POLL_MS = 150;
const OUTCOME_TIMEOUT_MS = 20_000;
const mainDirectory = dirname(fileURLToPath(import.meta.url));

function configPath(): string {
  return join(app.getPath("userData"), QUICK_UNLOCK_CONFIG_FILE);
}

const persistence: QuickUnlockPersistence = {
  read() {
    try {
      return JSON.parse(readFileSync(configPath(), "utf8")) as unknown;
    } catch {
      return null;
    }
  },
  write(value) {
    writeJsonAtomic(configPath(), value);
  },
  remove() {
    rmSync(configPath(), { force: true });
  },
};

async function secureStorageAvailable(): Promise<boolean> {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    if (process.platform === "linux") {
      const backend = safeStorage.getSelectedStorageBackend();
      return backend !== "basic_text" && backend !== "unknown";
    }
    return true;
  } catch {
    return false;
  }
}

const protector: DeviceKeyProtector = {
  available: secureStorageAvailable,
  async protect(key) {
    const encrypted = await safeStorage.encryptStringAsync(
      key.toString("base64"),
    );
    return encrypted.toString("base64");
  },
  async unprotect(protectedKey) {
    const { result } = await safeStorage.decryptStringAsync(
      Buffer.from(protectedKey, "base64"),
    );
    return Buffer.from(result, "base64");
  },
};

let vault: BrambleQuickUnlockVault | null = null;
function getVault(): BrambleQuickUnlockVault {
  vault ??= new BrambleQuickUnlockVault(persistence, protector);
  return vault;
}

/** Read Bramble's extension storage: does it hold a vault the PIN could unlock? */
export async function getBrambleVaultStatus(): Promise<BrambleVaultStatus> {
  try {
    return classifyBrambleVaultProbe(
      await evaluateInBrambleExtensionPage(BRAMBLE_VAULT_PROBE_SCRIPT),
    );
  } catch {
    return "unknown";
  }
}

function touchIdAvailable(): boolean {
  try {
    return (
      process.platform === "darwin" && systemPreferences.canPromptTouchID()
    );
  } catch {
    return false;
  }
}

export async function getQuickUnlockState(): Promise<BrambleQuickUnlockState> {
  const current = getVault();
  await current.load();
  const status = current.status();
  return {
    enabled: status.enabled,
    armed: status.armed,
    canRearm: status.canRearm,
    migratesOnRearm: status.migratesOnRearm,
    touchIdEnabled: status.touchIdEnabled,
    touchIdAvailable: touchIdAvailable(),
    requireMasterAfterRestart: status.requireMasterAfterRestart,
    persistAvailable: await secureStorageAvailable(),
    failedAttempts: status.failedAttempts,
    maxAttempts: status.maxAttempts,
    notice: status.notice,
    vault: await getBrambleVaultStatus(),
  };
}

async function publish(): Promise<BrambleQuickUnlockState> {
  const state = await getQuickUnlockState();
  try {
    sendToMainWindowRenderers("browser:bramble:quick-unlock:changed", state);
  } catch {
    /* window closing */
  }
  return state;
}

async function result(run: () => Promise<void>): Promise<QuickUnlockResult> {
  try {
    await run();
    return { ok: true, state: await publish() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      state: await publish(),
    };
  }
}

export function enrolQuickUnlock(input: unknown): Promise<QuickUnlockResult> {
  return result(async () => {
    const value = (
      typeof input === "object" && input !== null ? input : {}
    ) as Partial<BrambleQuickUnlockEnrolInput>;
    if (
      typeof value.masterPassword !== "string" ||
      typeof value.pin !== "string" ||
      typeof value.confirmPin !== "string"
    ) {
      throw new Error("Enter your master password and a PIN.");
    }
    // No vault, nothing to unlock: never take (and keep) a "master password" for a vault that does not exist.
    const blocker = quickUnlockSetupBlocker(await getBrambleVaultStatus());
    if (blocker) throw new Error(blocker);
    const wantsTouchId = value.touchId === true;
    if (wantsTouchId && !touchIdAvailable())
      throw new Error("Touch ID is not available on this Mac.");
    // Persisted (PIN survives restarts) is the default wherever safeStorage can protect the key.
    const requireMasterAfterRestart =
      typeof value.requireMasterAfterRestart === "boolean"
        ? value.requireMasterAfterRestart
        : !(await secureStorageAvailable());
    await getVault().enrol({
      masterPassword: value.masterPassword,
      pin: value.pin,
      confirmPin: value.confirmPin,
      touchId: wantsTouchId,
      requireMasterAfterRestart,
    });
  });
}

export function disableQuickUnlock(): Promise<QuickUnlockResult> {
  return result(async () => {
    getVault().disable();
    for (const session of sessions) session.hide();
  });
}

export function setQuickUnlockTouchId(
  enabled: unknown,
): Promise<QuickUnlockResult> {
  return result(() => getVault().setTouchIdEnabled(enabled === true));
}

/** Settings toggle: "Require master password after Surffish restarts". Turning it on needs the PIN. */
export function setQuickUnlockRequireMaster(
  input: unknown,
): Promise<QuickUnlockResult> {
  return result(async () => {
    const value = (
      typeof input === "object" && input !== null ? input : {}
    ) as { require?: unknown; pin?: unknown };
    if (typeof value.require !== "boolean")
      throw new Error("Not a valid setting.");
    await getVault().setRequireMasterAfterRestart(
      value.require,
      typeof value.pin === "string" ? value.pin : undefined,
    );
  });
}

// ---------------------------------------------------------------------------
// The panel over Bramble's popup

export interface QuickUnlockPopupHooks {
  /** Keep Bramble's popup open while it loses focus (the Touch ID sheet takes focus). */
  setBlurHold(hold: boolean): void;
}

type OverlayMode = "pin" | "notice";
type PanelResult =
  | { status: "ok" }
  | { status: "wrong"; attemptsLeft: number }
  | { status: "error"; message: string };

class PopupSession {
  private overlay: WebContentsView | null = null;
  private overlayReady: Promise<void> | null = null;
  private shown = false;
  /** The user chose "Use master password" for the current lock screen. */
  private dismissed = false;
  /** Touch ID was auto-offered for the current lock screen. */
  private autoOffered = false;
  private filling = false;
  private timer: NodeJS.Timeout | null = null;
  private detecting = false;
  private readonly onResize = (): void => this.layout();

  constructor(
    readonly popup: BrowserWindow,
    readonly extensionUrl: string,
    readonly hooks: QuickUnlockPopupHooks,
  ) {
    popup.on("resize", this.onResize);
    popup.once("closed", () => this.dispose());
    this.timer = setInterval(() => void this.detect(), DETECT_INTERVAL_MS);
    void this.detect();
  }

  get overlayContents(): Electron.WebContents | null {
    return this.overlay && !this.overlay.webContents.isDestroyed()
      ? this.overlay.webContents
      : null;
  }

  private async snapshot(): Promise<unknown> {
    const contents = this.popup.isDestroyed() ? null : this.popup.webContents;
    if (!contents || contents.isDestroyed() || contents.isLoading())
      return null;
    try {
      return await contents.executeJavaScriptInIsolatedWorld(
        ISOLATED_WORLD_ID,
        [{ code: UNLOCK_SNAPSHOT_SCRIPT }],
      );
    } catch {
      return null;
    }
  }

  private async detect(): Promise<void> {
    if (this.detecting || this.filling || this.popup.isDestroyed()) return;
    this.detecting = true;
    try {
      const status = getVault().status();
      // Not armed but re-armable (memory-only after a restart): Bramble's own form is the only
      // screen; collect what the user submits to it. Runs even while the popup is hidden, so a
      // submit right before the popup hides is not lost.
      if (status.enabled && !status.armed && status.canRearm)
        await this.observeMasterPassword();
      else await this.stopObserving();
      if (this.popup.isDestroyed() || !this.popup.isVisible()) return;
      if (!status.enabled || !status.armed) {
        if (this.shown && !this.noticeShown) this.hide();
        return;
      }
      const kind = classifyBrambleUnlockScreen(
        await this.snapshot(),
        this.extensionUrl,
      );
      if (kind !== "unlock") {
        // Unlocked some other way, or a different screen: the next lock screen is a new episode.
        this.dismissed = false;
        this.autoOffered = false;
        if (this.shown && !this.noticeShown) this.hide();
        return;
      }
      if (this.shown || this.dismissed) return;
      const touchId = status.touchIdArmed && touchIdAvailable();
      const autoTouchId = touchId && !this.autoOffered;
      this.autoOffered = true;
      await this.show("pin", { touchId, autoTouchId });
    } finally {
      this.detecting = false;
    }
  }

  /** The capture listener is active in the popup's current document. */
  private captureActive = false;

  /** Armed again (or quick unlock off): stop collecting and drop anything collected. */
  private async stopObserving(): Promise<void> {
    this.observedMaster = null;
    if (!this.captureActive) return;
    this.captureActive = false;
    const contents = this.popup.webContents;
    if (contents.isDestroyed()) return;
    try {
      await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
        { code: MASTER_CAPTURE_STOP_SCRIPT },
      ]);
    } catch {
      /* gone */
    }
  }

  /** A master password the user submitted to Bramble's form, waiting for Bramble's verdict. */
  private observedMaster: { value: string; deadline: number } | null = null;

  /**
   * Memory-only re-arm without a Surffish screen. A capture listener in Surffish's isolated world
   * (never Bramble's world) keeps the last value submitted through Bramble's single-field unlock
   * form; main takes it, waits until Bramble has actually unlocked with it, and only then offers it
   * to the vault, which re-arms only if it opens the PIN-under-master slot. Anything else is dropped.
   */
  private async observeMasterPassword(): Promise<void> {
    const contents = this.popup.webContents;
    if (contents.isDestroyed() || contents.isLoading()) return;
    let taken: unknown;
    try {
      taken = await contents.executeJavaScriptInIsolatedWorld(
        ISOLATED_WORLD_ID,
        [{ code: MASTER_CAPTURE_TAKE_SCRIPT }],
      );
    } catch {
      taken = null;
    }
    // A newer submit replaces the one still waiting (wrong password, then the right one).
    if (typeof taken === "string" && taken)
      this.observedMaster = {
        value: taken,
        deadline: Date.now() + OUTCOME_TIMEOUT_MS,
      };
    const pending = this.observedMaster;
    if (pending) {
      const outcome = classifyFillOutcome(
        await this.snapshot(),
        this.extensionUrl,
      );
      if (outcome === "unlocked") {
        this.observedMaster = null;
        try {
          const secret = await getVault().rearmWithMasterPassword(
            pending.value,
          );
          if (secret) {
            secret.fill(0);
            void publish();
          }
        } catch {
          /* stays not armed */
        }
        return;
      }
      if (outcome === "rejected" || Date.now() > pending.deadline)
        this.observedMaster = null;
    }
    // Keep the listener installed on whatever document the popup shows (idempotent).
    if (
      classifyBrambleUnlockScreen(await this.snapshot(), this.extensionUrl) ===
      "unlock"
    ) {
      try {
        await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
          { code: MASTER_CAPTURE_INSTALL_SCRIPT },
        ]);
        this.captureActive = true;
      } catch {
        /* page navigating */
      }
    }
  }

  private noticeShown = false;

  private ensureOverlay(): Promise<void> {
    if (
      this.overlay &&
      !this.overlay.webContents.isDestroyed() &&
      this.overlayReady
    )
      return this.overlayReady;
    const view = new WebContentsView({
      webPreferences: {
        preload: join(mainDirectory, "../preload/bramble-quick-unlock.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    this.overlay = view;
    const contents = view.webContents;
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("render-process-gone", () => {
      if (this.overlay === view) {
        this.overlay = null;
        this.overlayReady = null;
        this.shown = false;
      }
    });
    this.overlayReady = new Promise<void>((resolve) => {
      readyWaiters.set(contents.id, resolve);
      void contents
        .loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(QUICK_UNLOCK_OVERLAY_HTML)}`,
        )
        .catch(() => resolve());
      setTimeout(resolve, 5000);
    });
    return this.overlayReady;
  }

  private layout(): void {
    if (!this.overlay || this.popup.isDestroyed()) return;
    const [width, height] = this.popup.getContentSize();
    this.overlay.setBounds({
      x: 0,
      y: 0,
      width: width ?? 0,
      height: height ?? 0,
    });
  }

  async show(
    mode: OverlayMode,
    options: { touchId?: boolean; autoTouchId?: boolean; error?: string } = {},
  ): Promise<void> {
    await this.ensureOverlay();
    const view = this.overlay;
    if (!view || this.popup.isDestroyed()) return;
    if (!this.popup.contentView.children.includes(view))
      this.popup.contentView.addChildView(view);
    this.layout();
    this.shown = true;
    this.noticeShown = mode === "notice";
    view.webContents.send("bramble-quick-unlock:show", {
      mode,
      touchId: options.touchId === true,
      autoTouchId: options.autoTouchId === true,
      error: options.error ?? "",
    });
    view.webContents.focus();
  }

  hide(): void {
    this.shown = false;
    this.noticeShown = false;
    const view = this.overlay;
    if (
      view &&
      !this.popup.isDestroyed() &&
      this.popup.contentView.children.includes(view)
    ) {
      this.popup.contentView.removeChildView(view);
      if (!this.popup.webContents.isDestroyed()) this.popup.webContents.focus();
    }
  }

  useMasterPassword(): void {
    this.dismissed = true;
    this.hide();
  }

  /** Type the master password into Bramble's form, submit, and watch what Bramble does with it. */
  async fill(secret: Buffer): Promise<PanelResult> {
    const contents = this.popup.isDestroyed() ? null : this.popup.webContents;
    if (!contents || contents.isDestroyed()) {
      secret.fill(0);
      return { status: "error", message: "Bramble’s window closed." };
    }
    this.filling = true;
    // Never let our own fill's submit be collected as something the user typed.
    await this.stopObserving();
    try {
      const before = classifyBrambleUnlockScreen(
        await this.snapshot(),
        this.extensionUrl,
      );
      if (before !== "unlock")
        return {
          status: "error",
          message: "Bramble is not showing its unlock screen.",
        };
      const script = buildUnlockFillScript(secret.toString("utf8"));
      secret.fill(0);
      let submitted = false;
      try {
        submitted =
          (await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
            { code: script },
          ])) === true;
      } catch {
        submitted = false;
      }
      if (!submitted)
        return {
          status: "error",
          message: "Surffish could not fill Bramble’s unlock form.",
        };
      const deadline = Date.now() + OUTCOME_TIMEOUT_MS;
      // Give React a moment to mark the form busy before reading it.
      await delay(OUTCOME_POLL_MS);
      while (Date.now() < deadline && !contents.isDestroyed()) {
        const outcome = classifyFillOutcome(
          await this.snapshot(),
          this.extensionUrl,
        );
        if (outcome === "unlocked") {
          this.hide();
          return { status: "ok" };
        }
        if (outcome === "rejected") {
          getVault().masterPasswordRejected();
          void publish();
          await this.show("notice", { error: MASTER_CHANGED_NOTICE });
          this.dismissed = true;
          return { status: "error", message: MASTER_CHANGED_NOTICE };
        }
        await delay(OUTCOME_POLL_MS);
      }
      this.hide();
      this.dismissed = true;
      return { status: "error", message: "Bramble did not finish unlocking." };
    } finally {
      secret.fill(0);
      this.filling = false;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    sessions.delete(this);
    if (!this.popup.isDestroyed())
      this.popup.removeListener("resize", this.onResize);
    const contents = this.overlayContents;
    this.overlay = null;
    if (contents) contents.close();
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const sessions = new Set<PopupSession>();
const attached = new WeakSet<BrowserWindow>();
const readyWaiters = new Map<number, () => void>();
let ipcRegistered = false;

function sessionFor(
  event: IpcMainEvent | IpcMainInvokeEvent,
): PopupSession | null {
  for (const session of sessions) {
    const contents = session.overlayContents;
    if (
      contents &&
      contents === event.sender &&
      event.senderFrame === contents.mainFrame
    )
      return session;
  }
  return null;
}

function registerOverlayIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on("bramble-quick-unlock:ready", (event) => {
    if (!sessionFor(event)) return;
    const resolve = readyWaiters.get(event.sender.id);
    readyWaiters.delete(event.sender.id);
    resolve?.();
  });
  ipcMain.on("bramble-quick-unlock:use-master", (event) => {
    sessionFor(event)?.useMasterPassword();
  });
  ipcMain.handle(
    "bramble-quick-unlock:pin",
    async (event, pin: unknown): Promise<PanelResult> => {
      const session = sessionFor(event);
      if (!session) throw new Error("Not available.");
      const outcome = await getVault().attemptPin(
        typeof pin === "string" ? pin : "",
      );
      if (outcome.status === "ok") {
        void publish();
        return session.fill(outcome.secret);
      }
      void publish();
      if (outcome.status === "wrong")
        return { status: "wrong", attemptsLeft: outcome.attemptsLeft };
      const message =
        outcome.status === "locked-out"
          ? (getVault().status().notice ?? "Quick unlock was turned off.")
          : "Quick unlock is not set up.";
      await session.show("notice", { error: message });
      return { status: "error", message };
    },
  );
  ipcMain.handle(
    "bramble-quick-unlock:touch-id",
    async (event): Promise<PanelResult> => {
      const session = sessionFor(event);
      if (!session) throw new Error("Not available.");
      if (!touchIdAvailable())
        return { status: "error", message: "Touch ID is not available." };
      session.hooks.setBlurHold(true);
      try {
        await systemPreferences.promptTouchID("unlock Bramble");
      } catch {
        return {
          status: "error",
          message: "Touch ID was cancelled. Enter your PIN instead.",
        };
      } finally {
        session.hooks.setBlurHold(false);
        if (!session.popup.isDestroyed()) session.popup.focus();
        session.overlayContents?.focus();
      }
      const secret = await getVault().unlockWithDeviceKey();
      if (!secret)
        return {
          status: "error",
          message: "Touch ID unlock is not set up. Enter your PIN.",
        };
      return session.fill(secret);
    },
  );
}

/** Watch one Bramble popup window for its unlock screen. Called by bramble-poc.ts. */
export async function attachBrambleQuickUnlock(
  popup: BrowserWindow,
  extensionUrl: string,
  hooks: QuickUnlockPopupHooks,
): Promise<void> {
  if (popup.isDestroyed() || attached.has(popup)) return;
  const current = getVault();
  await current.load();
  if (!current.status().enabled || popup.isDestroyed() || attached.has(popup))
    return;
  attached.add(popup);
  registerOverlayIpc();
  sessions.add(new PopupSession(popup, extensionUrl, hooks));
}
