import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  inspectPasswordExtensionCompatibility,
  type ExtensionSourceFile,
  type PasswordExtensionManifest,
  type PasswordManagerTarget,
} from "../src/shared/password-extension-compat.ts";

const [targetInput, pathInput] = process.argv.slice(2);
if ((targetInput !== "bitwarden" && targetInput !== "bramble") || !pathInput) {
  console.error(
    "Usage: npm run check:password-extension -- <bitwarden|bramble> <unpacked-extension-directory-or-manifest.json>",
  );
  process.exitCode = 2;
} else {
  const target = targetInput as PasswordManagerTarget;
  const inputPath = resolve(pathInput);
  try {
    if (/\.(xpi|crx)$/i.test(inputPath)) {
      throw new Error(
        "Pass an unpacked extension directory or manifest.json. Firefox .xpi and Chrome .crx packages are not loaded or executed by this static checker; extract an archive first.",
      );
    }

    const isDirectory =
      existsSync(inputPath) && statSync(inputPath).isDirectory();
    const manifestPath = isDirectory
      ? join(inputPath, "manifest.json")
      : inputPath;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      Array.isArray(manifest)
    ) {
      throw new Error("The manifest root must be a JSON object.");
    }

    const sourceRoot = isDirectory ? inputPath : dirname(manifestPath);
    const sourceFiles: ExtensionSourceFile[] = [];
    let scannedFileCount = 0;
    const maximumSourceFiles = 20_000;
    const maximumSourceFileBytes = 10 * 1024 * 1024;

    function visit(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "vendor"
        )
          continue;
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
          continue;
        }
        if (!entry.isFile() || !/\.(?:js|mjs|cjs)$/i.test(entry.name)) continue;
        scannedFileCount += 1;
        if (scannedFileCount > maximumSourceFiles)
          throw new Error(
            `Extension contains more than ${maximumSourceFiles} JavaScript files; refusing to scan an unexpectedly large source tree.`,
          );
        if (statSync(absolutePath).size > maximumSourceFileBytes) continue;
        sourceFiles.push({
          path: relative(sourceRoot, absolutePath),
          content: readFileSync(absolutePath, "utf8"),
        });
      }
    }
    if (existsSync(sourceRoot) && statSync(sourceRoot).isDirectory())
      visit(sourceRoot);

    const report = inspectPasswordExtensionCompatibility(
      target,
      manifest as PasswordExtensionManifest,
      sourceFiles,
    );
    console.log(
      `${report.extensionName} (Manifest ${report.manifestVersion ?? "unknown"})`,
    );
    console.log(
      `Static-only inspection: ${sourceFiles.length} JavaScript files scanned; extension code was not executed.`,
    );
    if (report.observedApis.length > 0) {
      console.log(
        `Observed extension API references: ${report.observedApis.join(", ")}`,
      );
    } else {
      console.log(
        "No chrome.* or browser.* API references were found in scanned JavaScript files.",
      );
    }

    for (const issue of report.issues) {
      console.log(`[${issue.severity}:${issue.kind}] ${issue.message}`);
    }
    if (report.noDeclaredBlockers) {
      console.log(
        "No declared blocker was detected by this static check. Runtime compatibility is not verified.",
      );
    } else {
      console.log(
        "This package has declared or source-visible blockers for the documented Electron extension surface; it was not loaded or executed.",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `Could not inspect ${inputPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
}
