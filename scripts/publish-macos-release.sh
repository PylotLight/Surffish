#!/usr/bin/env bash
set -Eeuo pipefail

VERSION='0.1.0'
TAG="v${VERSION}"
BRANCH='main'
REPO='PylotLight/Surffish'
TITLE='Surffish 0.1.0 — Security and Session Privacy'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="$ROOT/release"
ZIP="$ARTIFACT_DIR/Surffish-${VERSION}-mac-arm64.zip"
DMG="$ARTIFACT_DIR/Surffish-${VERSION}-mac-arm64.dmg"
TEMP_DIR=''
PUBLISH_STARTED=0

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/publish-macos-release.sh <final-release-notes.md>
  bash scripts/publish-macos-release.sh --reuse-artifacts <source-commit> <final-release-notes.md>

The default mode runs checks and builds the 0.1.0 ARM64 macOS artifacts. The
reuse mode skips only the packaging build and uses existing ARM64 ZIP/DMG files;
it requires the full 40-character source commit and a separate interactive
attestation that both files were built from that exact commit. The declared
commit must be an ancestor of current origin/main, and only documentation or
this publishing helper may differ from it; the release tag still targets the
current origin/main commit.

Both modes validate and preview the exact release payload, then require typing
"PUBLISH v0.1.0" before creating/pushing the tag, creating the public GitHub
release with the ARM64 ZIP and DMG only, and pushing the rendered Homebrew Cask
update to main.

The notes file must be final (not a draft). Run this from a clean, current main
checkout with Bun, GitHub CLI authentication, and Apple's command-line tools.
USAGE
}

fail() {
  printf '[release] ERROR: %s\n' "$*" >&2
  if (( PUBLISH_STARTED )); then
    printf '[release] WARNING: a tag or public release may already exist. Inspect GitHub and the current Git status before attempting recovery.\n' >&2
  fi
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

on_error() {
  status=$?
  if (( PUBLISH_STARTED )); then
    printf '\n[release] A publish step failed after confirmation. Inspect tag %s and GitHub release %s before retrying; the tag or public release may already exist. The Cask push may still need to be completed.\n' "$TAG" "$TAG" >&2
  fi
  exit "$status"
}
trap on_error ERR
trap 'if [[ -n "$TEMP_DIR" ]]; then rm -rf "$TEMP_DIR"; fi' EXIT

REUSE_EXISTING_ARTIFACTS=0
ARTIFACT_SOURCE_COMMIT=''
if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  usage
  exit 0
fi
if [[ "${1:-}" == '--reuse-artifacts' ]]; then
  if [[ "$#" -ne 3 ]]; then
    usage >&2
    exit 2
  fi
  REUSE_EXISTING_ARTIFACTS=1
  ARTIFACT_SOURCE_COMMIT="$2"
  NOTES_ARGUMENT="$3"
  [[ "$ARTIFACT_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'Reuse mode requires the full 40-character lowercase source commit SHA used to build the artifacts.'
else
  if [[ "$#" -ne 1 ]]; then
    usage >&2
    exit 2
  fi
  NOTES_ARGUMENT="$1"
fi

case "$NOTES_ARGUMENT" in
  /*) NOTES_FILE="$NOTES_ARGUMENT" ;;
  *) NOTES_FILE="$ROOT/$NOTES_ARGUMENT" ;;
esac
[[ -f "$NOTES_FILE" && -s "$NOTES_FILE" ]] || fail "Final release notes file is missing or empty: $NOTES_FILE"
if grep -Eiq '(^|[^[:alpha:]])draft([^[:alpha:]]|$)' "$NOTES_FILE"; then
  fail 'The notes file still contains the word "draft"; finalize and review release notes before publishing.'
fi
NOTES_FILE="$(cd -- "$(dirname -- "$NOTES_FILE")" && pwd)/$(basename -- "$NOTES_FILE")"

cd "$ROOT"
for command_name in git bun gh shasum awk sort unzip ditto hdiutil lipo; do
  require_command "$command_name"
done
[[ -x /usr/libexec/PlistBuddy ]] || fail 'Apple PlistBuddy is unavailable; install Xcode Command Line Tools.'
[[ "$(uname -s)" == 'Darwin' ]] || fail 'This release must be built on macOS.'
[[ "$(uname -m)" == 'arm64' ]] || fail 'Run this from a native Apple-silicon (arm64) shell, not Intel or Rosetta.'

CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] || fail "Expected branch $BRANCH, found ${CURRENT_BRANCH:-detached HEAD}."
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'The worktree is not clean. Commit or stash all changes before releasing.'

ORIGIN_URL="$(git remote get-url origin)" || fail 'Git remote "origin" is not configured.'
NORMALIZED_ORIGIN_URL="$ORIGIN_URL"
if [[ "$ORIGIN_URL" == https://*@github.com/* ]]; then
  REMOTE_REMAINDER="${ORIGIN_URL#https://}"
  REMOTE_AUTHORITY="${REMOTE_REMAINDER%%/*}"
  REMOTE_HOST="${REMOTE_AUTHORITY##*@}"
  REMOTE_PATH="${REMOTE_REMAINDER#*/}"
  if [[ "$REMOTE_HOST" == 'github.com' ]]; then
    NORMALIZED_ORIGIN_URL="https://github.com/$REMOTE_PATH"
  fi
fi
case "$NORMALIZED_ORIGIN_URL" in
  https://github.com/PylotLight/Surffish|https://github.com/PylotLight/Surffish.git|git@github.com:PylotLight/Surffish.git|ssh://git@github.com/PylotLight/Surffish.git) ;;
  *) fail 'origin must resolve to the configured PylotLight/Surffish GitHub repository.' ;;
esac

gh auth status --hostname github.com >/dev/null 2>&1 || fail 'GitHub CLI is not authenticated for github.com; run gh auth login on your Mac, then retry.'
gh repo view "$REPO" --json nameWithOwner --jq '.nameWithOwner' >/dev/null || fail "GitHub CLI cannot access $REPO."

git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
COMMIT="$(git rev-parse HEAD)"
REMOTE_MAIN="$(git rev-parse "refs/remotes/origin/$BRANCH")"
[[ "$COMMIT" == "$REMOTE_MAIN" ]] || fail 'Local main is not exactly at origin/main. Update/push the approved source commit, then retry.'
if (( REUSE_EXISTING_ARTIFACTS )); then
  git cat-file -e "${ARTIFACT_SOURCE_COMMIT}^{commit}" 2>/dev/null || fail "The declared artifact source commit is not present in this checkout: $ARTIFACT_SOURCE_COMMIT."
  git merge-base --is-ancestor "$ARTIFACT_SOURCE_COMMIT" "$COMMIT" || fail 'The artifact source commit is not an ancestor of current origin/main; refusing to reuse artifacts from another line of history.'
  SOURCE_DIFF_FILES="$(git diff --name-only "$ARTIFACT_SOURCE_COMMIT" "$COMMIT")" || fail 'Could not compare the artifact source commit with current origin/main.'
  UNSAFE_SOURCE_DIFF=''
  if [[ -n "$SOURCE_DIFF_FILES" ]]; then
    UNSAFE_SOURCE_DIFF="$(printf '%s\n' "$SOURCE_DIFF_FILES" | grep -Ev '^(\.gitignore$|docs/|scripts/publish-macos-release\.sh$)' || true)"
  fi
  [[ -z "$UNSAFE_SOURCE_DIFF" ]] || fail "Application/build files changed after the artifact source commit; rebuild instead of reusing these artifacts. Changed files:\n$UNSAFE_SOURCE_DIFF"
fi
git var GIT_COMMITTER_IDENT >/dev/null || fail 'Git commit identity is not configured; set user.name and user.email before running this script.'

BUN_RELEASE_VERSION="$VERSION" bun -e '
const fs = require("node:fs")
const version = process.env.BUN_RELEASE_VERSION
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
if (pkg.version !== version) {
  console.error("[release] package.json version must be " + version + "; found " + pkg.version)
  process.exit(1)
}
const targets = (pkg.build && pkg.build.mac && pkg.build.mac.target) || []
const expected = new Map([["zip", false], ["dmg", false]])
for (const entry of targets) {
  const target = typeof entry === "string" ? entry : entry.target
  const arch = typeof entry === "string" ? [] : entry.arch
  if (!expected.has(target) || !Array.isArray(arch) || arch.length !== 1 || arch[0] !== "arm64") {
    console.error("[release] Unexpected macOS target; expected only arm64 ZIP and DMG targets.")
    process.exit(1)
  }
  expected.set(target, true)
}
if ([...expected.values()].some((present) => !present)) {
  console.error("[release] package.json must define both ZIP and DMG targets for arm64.")
  process.exit(1)
}
'

LOCAL_TAG="$(git tag --list "$TAG")"
[[ -z "$LOCAL_TAG" ]] || fail "Local tag $TAG already exists."
REMOTE_TAG="$(git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}")" || fail 'Could not check remote tags.'
[[ -z "$REMOTE_TAG" ]] || fail "Remote tag $TAG already exists."
EXISTING_RELEASE="$(gh release list --repo "$REPO" --json tagName --jq ".[] | select(.tagName == \"$TAG\") | .tagName")" || fail 'Could not check existing GitHub releases.'
[[ -z "$EXISTING_RELEASE" ]] || fail "GitHub release $TAG already exists."

printf '\n[release] Running typecheck and unit tests...\n'
bun run typecheck
bun run test
if (( REUSE_EXISTING_ARTIFACTS )); then
  printf '[release] Reusing the existing ARM64 ZIP and DMG; dist:mac will not run.\n'
else
  printf '[release] Building the macOS ARM64 packaging artifacts...\n'
  bun run dist:mac
fi

[[ -s "$ZIP" ]] || fail "Expected ZIP is missing or empty: $ZIP"
[[ -s "$DMG" ]] || fail "Expected DMG is missing or empty: $DMG"
STALE_INTEL=''
for stale_artifact in "$ARTIFACT_DIR/Surffish-${VERSION}-mac-x64.zip" "$ARTIFACT_DIR/Surffish-${VERSION}-mac-x64.dmg"; do
  if [[ -e "$stale_artifact" ]]; then
    STALE_INTEL="${STALE_INTEL}${stale_artifact}"$'\n'
  fi
done
[[ -z "$STALE_INTEL" ]] || fail "Stale Intel artifact(s) found; remove or inspect before release:\n$STALE_INTEL"

unzip -tq "$ZIP" >/dev/null || fail 'The ARM64 ZIP failed its integrity check.'
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/surffish-release.XXXXXX")"
ZIP_EXTRACT="$TEMP_DIR/zip"
mkdir -p "$ZIP_EXTRACT"
ditto -x -k "$ZIP" "$ZIP_EXTRACT"
INFO_PLIST="$(find "$ZIP_EXTRACT" -type f -path '*/Surffish.app/Contents/Info.plist' -print -quit)"
[[ -n "$INFO_PLIST" ]] || fail 'The ZIP does not contain Surffish.app/Contents/Info.plist.'
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST")"
[[ "$BUNDLE_ID" == 'com.pylotlight.surffish' ]] || fail "Unexpected app bundle identifier in ZIP: $BUNDLE_ID"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")"
[[ "$APP_VERSION" == "$VERSION" ]] || fail "Unexpected app version in ZIP: $APP_VERSION (expected $VERSION)."
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST")"
APP_BINARY="$(dirname -- "$INFO_PLIST")/MacOS/$EXECUTABLE"
[[ -s "$APP_BINARY" ]] || fail 'The app executable is missing from the ARM64 ZIP.'
APP_ARCHS="$(lipo -archs "$APP_BINARY")"
[[ "$APP_ARCHS" == 'arm64' ]] || fail "The app executable must contain only arm64 (found: $APP_ARCHS)."
hdiutil verify "$DMG" >/dev/null || fail 'The DMG failed hdiutil verification.'

ZIP_SHA256="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
DMG_SHA256="$(shasum -a 256 "$DMG" | awk '{print $1}')"
[[ "$ZIP_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail 'Could not calculate a valid ZIP SHA-256 checksum.'
[[ "$DMG_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail 'Could not calculate a valid DMG SHA-256 checksum.'

RENDERED_CASK="$TEMP_DIR/surffish.rb"
bun scripts/render-cask.ts \
  --version "$VERSION" \
  --sha256-arm64 "$ZIP_SHA256" \
  --out "$RENDERED_CASK"
grep -Fq "sha256 \"$ZIP_SHA256\"" "$RENDERED_CASK" || fail 'Rendered Cask does not contain the ZIP checksum.'

printf '\n============================================================\n'
printf 'PUBLIC RELEASE CONFIRMATION — review every item below\n'
printf 'Repository: %s\nBranch: %s\nRelease tag commit: %s\nTag: %s\nTitle: %s\n' "$REPO" "$BRANCH" "$COMMIT" "$TAG" "$TITLE"
if (( REUSE_EXISTING_ARTIFACTS )); then
  printf 'Artifact mode: reuse existing ARM64 ZIP and DMG (no packaging rebuild)\n'
  printf 'Declared artifact source commit: %s\n' "$ARTIFACT_SOURCE_COMMIT"
else
  printf 'Artifact mode: build ARM64 ZIP and DMG on this run\n'
fi
printf 'The public release will contain exactly these two assets:\n'
printf '  %s  (%s bytes)\n  SHA-256: %s\n' "$(basename "$ZIP")" "$(stat -f '%z' "$ZIP")" "$ZIP_SHA256"
printf '  %s  (%s bytes)\n  SHA-256: %s\n' "$(basename "$DMG")" "$(stat -f '%z' "$DMG")" "$DMG_SHA256"
printf '\nRelease notes from %s:\n' "$NOTES_FILE"
printf '%s\n' '--------------------'
cat "$NOTES_FILE"
printf '%s\n' '--------------------'
printf '\nAfter release asset verification, this will render and push Casks/surffish.rb using the ZIP SHA-256 above.\n'
printf 'No GitHub Actions workflow will be enabled or changed.\n\n'
[[ -r /dev/tty ]] || fail 'An interactive terminal is required for the publish confirmation.'
if (( REUSE_EXISTING_ARTIFACTS )); then
  printf '[release] The archives cannot prove their own source commit. Confirm that BOTH existing artifacts were built from the exact declared artifact source commit shown above.\n'
  read -r -p "Type ARTIFACT SOURCE COMMIT $ARTIFACT_SOURCE_COMMIT to attest to that exact source: " ARTIFACT_SOURCE_CONFIRMATION </dev/tty
  [[ "$ARTIFACT_SOURCE_CONFIRMATION" == "ARTIFACT SOURCE COMMIT $ARTIFACT_SOURCE_COMMIT" ]] || fail 'Artifact source commit confirmation did not match; nothing was published.'
fi
read -r -p 'Type PUBLISH v0.1.0 to create/push the public tag and release, then push the Cask: ' CONFIRMATION </dev/tty
[[ "$CONFIRMATION" == "PUBLISH $TAG" ]] || fail 'Confirmation did not match; nothing was published.'

# Recheck mutable preconditions immediately before the first external write.
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail 'Branch changed after the confirmation preview.'
[[ "$(git rev-parse HEAD)" == "$COMMIT" ]] || fail 'HEAD changed after the confirmation preview.'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'The worktree changed after the confirmation preview.'
REMOTE_MAIN="$(git ls-remote origin "refs/heads/$BRANCH" | awk 'NR == 1 {print $1}')"
[[ "$REMOTE_MAIN" == "$COMMIT" ]] || fail 'origin/main moved after the confirmation preview; nothing was published.'
REMOTE_TAG="$(git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}")" || fail 'Could not recheck remote tags.'
[[ -z "$REMOTE_TAG" ]] || fail "Remote tag $TAG appeared after the preview; nothing was published."
EXISTING_RELEASE="$(gh release list --repo "$REPO" --json tagName --jq ".[] | select(.tagName == \"$TAG\") | .tagName")" || fail 'Could not recheck existing GitHub releases.'
[[ -z "$EXISTING_RELEASE" ]] || fail "GitHub release $TAG appeared after the preview; nothing was published."
CURRENT_ZIP_SHA256="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
CURRENT_DMG_SHA256="$(shasum -a 256 "$DMG" | awk '{print $1}')"
[[ "$CURRENT_ZIP_SHA256" == "$ZIP_SHA256" && "$CURRENT_DMG_SHA256" == "$DMG_SHA256" ]] || fail 'A release artifact changed after the preview; nothing was published.'

PUBLISH_STARTED=1
printf '\n[release] Creating and pushing annotated tag %s...\n' "$TAG"
git tag -a "$TAG" "$COMMIT" -m "$TITLE"
git push origin "$TAG"
printf '[release] Creating the public GitHub release with the two ARM64 assets...\n'
gh release create "$TAG" "$ZIP" "$DMG" \
  --repo "$REPO" \
  --title "$TITLE" \
  --notes-file "$NOTES_FILE" \
  --verify-tag

PUBLISHED_ASSETS="$(gh release view "$TAG" --repo "$REPO" --json assets --template '{{range .assets}}{{.name}}{{"\n"}}{{end}}' | LC_ALL=C sort)"
EXPECTED_ASSETS="$(printf '%s\n%s\n' "$(basename "$ZIP")" "$(basename "$DMG")" | LC_ALL=C sort)"
[[ "$PUBLISHED_ASSETS" == "$EXPECTED_ASSETS" ]] || fail "Published release asset list did not match the two approved ARM64 files. Found:\n$PUBLISHED_ASSETS"

printf '[release] Rendering and pushing the Cask update...\n'
bun scripts/render-cask.ts \
  --version "$VERSION" \
  --sha256-arm64 "$ZIP_SHA256" \
  --out Casks/surffish.rb
git add -- Casks/surffish.rb
if git diff --cached --quiet -- Casks/surffish.rb; then
  git reset -q -- Casks/surffish.rb
  printf '[release] Cask already matched the released ZIP checksum; no Cask commit was needed.\n'
else
  git commit -m "chore(tap): update Surffish Cask to v${VERSION}"
  git push origin "$BRANCH"
fi

PUBLISH_STARTED=0
printf '\n[release] Complete: %s is published and the Cask update is pushed to %s.\n' "$TAG" "$BRANCH"
