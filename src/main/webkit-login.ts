import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { isCookieDomainAllowed } from "../shared/webkit-login.ts";
import { getBrowserSession } from "./browser-session";
import { fetchBrambleLogin, findBrambleLogins } from "./bramble-poc";
import {
  helperFrameArgument,
  isBrambleFillHost,
  parseHelperMessage,
  toElectronCookie,
  type WebKitCookie,
} from "./google-webkit-sign-in-policy.ts";
import { getMainWindow } from "./window";

export type WebKitLoginResult =
  "signed-in" | "cancelled" | "unavailable" | "failed";

let running: Promise<WebKitLoginResult> | null = null;

function helperPath(): string | null {
  if (process.platform !== "darwin") return null;
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../native/webkit-login",
  ).replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return existsSync(path) ? path : null;
}

export function isWebKitLoginAvailable(): boolean {
  return helperPath() !== null;
}

/**
 * Open the login in native WebKit, then import the cookies it returns into the profile session.
 * The helper exits 0 after emitting cookies, 2 when the window was closed without finishing.
 */
export function runWebKitLogin(
  url: string,
  domains: readonly string[],
): Promise<WebKitLoginResult> {
  // A previous helper window might still be open (e.g. left from a test). Starting a fresh one is
  // the only way a new navigation can bring a window forward — never just reuse the old promise.
  if (running)
    console.info(
      "[webkit-login] previous helper still open; starting a new one",
    );
  const path = helperPath();
  if (!path) return Promise.resolve("unavailable");

  running = new Promise<WebKitLoginResult>((resolve) => {
    const owner = getMainWindow();
    const frame = helperFrameArgument(
      owner && !owner.isDestroyed() ? owner.getBounds() : null,
    );
    const args = [url, `--domain=${domains[0] ?? ""}`];
    if (frame) args.push(frame);
    console.info("[webkit-login] starting helper:", path, args.join(" "));
    const child = spawn(path, args, { stdio: ["pipe", "pipe", "inherit"] });
    let cookies: WebKitCookie[] | null = null;
    let lastListHost = "";
    const reply = (message: Record<string, unknown>) => {
      if (child.stdin && !child.stdin.destroyed)
        child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    child.stdin?.on("error", () => {});
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const message = parseHelperMessage(line);
      if (!message) return;
      if (message.type === "cookies") cookies = message.cookies;
      else if (message.type === "bramble-list") {
        if (!isBrambleFillHost(message.host))
          return reply({
            type: "bramble-list",
            status: "unavailable",
            logins: [],
          });
        lastListHost = message.host;
        void findBrambleLogins(message.host).then((result) =>
          reply({ type: "bramble-list", logins: [], ...result }),
        );
      } else if (message.type === "bramble-fill") {
        if (!isBrambleFillHost(lastListHost))
          return reply({ type: "bramble-fill", status: "unavailable" });
        void fetchBrambleLogin(lastListHost, message.id).then((secret) =>
          reply(
            secret
              ? { type: "bramble-fill", status: "ok", ...secret }
              : { type: "bramble-fill", status: "unavailable" },
          ),
        );
      }
    });
    child.on("error", (error) => {
      running = null;
      console.warn("[webkit-login] helper failed to start:", error);
      resolve("failed");
    });
    child.on("close", async (code) => {
      running = null;
      console.info(
        `[webkit-login] helper exited (${code}), cookies: ${cookies?.length ?? 0}`,
      );
      if (code !== 0) return resolve(code === 2 ? "cancelled" : "failed");
      if (!cookies) return resolve("failed");
      const allowed = (domain: string): boolean =>
        isCookieDomainAllowed(domain, domains);
      const session = getBrowserSession();
      let imported = 0;
      const names: string[] = [];
      for (const cookie of cookies) {
        try {
          // WKWebView can report a parent cookie as "torbox.app". Electron would treat a bare
          // domain as host-only, so the www site would never receive it. Make it a domain cookie.
          const bare = cookie.domain.replace(/^\./, "").toLowerCase();
          const normalized =
            bare === domains[0] && !cookie.domain.startsWith(".")
              ? { ...cookie, domain: `.${bare}` }
              : cookie;
          const details = toElectronCookie(normalized, allowed);
          if (!details) continue;
          await session.cookies.set(details);
          imported += 1;
          names.push(`${details.name}@${details.domain ?? "(host)"}`);
        } catch (error) {
          console.warn(
            `[webkit-login] could not import ${cookie.name}:`,
            error,
          );
        }
      }
      if (imported > 0) await session.cookies.flushStore();
      console.log(
        `[webkit-login] imported ${imported}/${cookies.length} cookie(s): ${names.join(", ") || "none"}`,
      );
      resolve(imported > 0 ? "signed-in" : "failed");
    });
  });
  return running;
}
