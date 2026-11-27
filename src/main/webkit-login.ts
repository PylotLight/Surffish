import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { isCookieDomainAllowed } from "../shared/webkit-login.ts";
import { getBrowserSession } from "./browser-session";
import {
  helperFrameArgument,
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
  if (running) {
    console.info("[webkit-login] helper already running; reusing its window");
    return running;
  }
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
    const child = spawn(path, args, { stdio: ["ignore", "pipe", "inherit"] });
    let cookies: WebKitCookie[] | null = null;

    createInterface({ input: child.stdout! }).on("line", (line) => {
      const message = parseHelperMessage(line);
      if (message?.type === "cookies") cookies = message.cookies;
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
      for (const cookie of cookies) {
        const details = toElectronCookie(cookie, allowed);
        if (!details) continue;
        try {
          await session.cookies.set(details);
          imported += 1;
        } catch (error) {
          console.warn(
            `[webkit-login] could not import cookie ${details.name}:`,
            error,
          );
        }
      }
      if (imported > 0) await session.cookies.flushStore();
      console.log(
        `[webkit-login] imported ${imported} cookie(s) from the WebKit session.`,
      );
      resolve(imported > 0 ? "signed-in" : "failed");
    });
  });
  return running;
}
