#!/usr/bin/env bash
set -Eeuo pipefail

VERSION='0.1.0'
TAG="v${VERSION}"
BRANCH='main'
REPO='PylotLight/Surffish'
TITLE='Surffish 0.1.0 — Security and Session Privacy'
EXPECTED_TAG_COMMIT='7fd28435d2d4b0ab34987ee4ebc3c8a350ca8de3'
EXPECTED_TAG_OBJECT='f68b9ea2fbced8ab158f7f23d6329aca90f0b9af'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/fish-ghp.sh"
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
release-helper files may differ from it.

This helper resumes only the already-published annotated v0.1.0 tag, which must
match its pinned tag object and commit. It never creates, moves, deletes, or
pushes a tag. Both modes preview the release payload and require typing
"PUBLISH v0.1.0" before creating a new public GitHub release (or resuming an
already matching one), verifying its two ARM64 assets, and pushing the rendered
Homebrew Cask update to main.

The notes file must be final (not a draft). Run this from a clean, current main
checkout with Bun, GitHub CLI authentication, and Apple's command-line tools.
USAGE
}

fail() {
  printf '[release] ERROR: %s\n' "$*" >&2
  if (( PUBLISH_STARTED )); then
    printf '[release] WARNING: the release may already exist. The tag was not changed. Inspect the release assets and current Git status before retrying; the Cask push may still need to be completed.\n' >&2
  fi
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

on_error() {
  status=$?
  if (( PUBLISH_STARTED )); then
    printf '\n[release] A publish step failed after confirmation. Inspect release %s before retrying; this helper never changes the tag. The Cask push may still need to be completed.\n' "$TAG" >&2
  fi
  exit "$status"
}

verify_release_record() {
  local metadata
  local assets
  local expected_metadata

  metadata="$(surffish_ghp release view "$TAG" --repo "$REPO" \
    --json tagName,name,isDraft,isPrerelease \
    --jq '[.tagName, .name, (.isDraft | tostring), (.isPrerelease | tostring)] | @tsv')" || fail "Could not inspect GitHub release $TAG."
  expected_metadata="$(printf '%s\t%s\tfalse\tfalse' "$TAG" "$TITLE")"
  [[ "$metadata" == "$expected_metadata" ]] || fail "GitHub release $TAG conflicts with the expected title, tag, or public release state."

  assets="$(surffish_ghp release view "$TAG" --repo "$REPO" --json assets \
    --template '{{range .assets}}{{.name}}{{"\n"}}{{end}}' | LC_ALL=C sort)" || fail "Could not inspect the assets for GitHub release $TAG."
  [[ "$assets" == "$EXPECTED_ASSETS" ]] || fail "Release $TAG must contain exactly the two approved ARM64 assets. Found:\n$assets"
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
[[ -r "$ROOT/scripts/release-tag-guard.sh" ]] || fail 'The release tag validation helper is missing.'
source "$ROOT/scripts/release-tag-guard.sh"
for command_name in git bun fish shasum awk sort unzip ditto hdiutil lipo cmp stat; do
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

surffish_ghp auth status --hostname github.com >/dev/null 2>&1 || fail 'The ghp Fish function is not authenticated for github.com; run ghp auth login in Fish, then retry.'
surffish_ghp repo view "$REPO" --json nameWithOwner --jq '.nameWithOwner' >/dev/null || fail "The ghp Fish function cannot access $REPO."

git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
COMMIT="$(git rev-parse HEAD)"
REMOTE_MAIN="$(git rev-parse "refs/remotes/origin/$BRANCH")"
[[ "$COMMIT" == "$REMOTE_MAIN" ]] || fail 'Local main is not exactly at origin/main. Update/push the approved source commit, then retry.'
surffish_validate_existing_tag "$TAG" "$EXPECTED_TAG_COMMIT" "$EXPECTED_TAG_OBJECT" origin || fail 'The existing v0.1.0 tag is not the exact pinned tag; no tag will be created, pushed, or modified.'
git merge-base --is-ancestor "$EXPECTED_TAG_COMMIT" "$COMMIT" || fail 'The pinned release tag commit is not an ancestor of current origin/main.'

if (( REUSE_EXISTING_ARTIFACTS )); then
  git cat-file -e "${ARTIFACT_SOURCE_COMMIT}^{commit}" 2>/dev/null || fail "The declared artifact source commit is not present in this checkout: $ARTIFACT_SOURCE_COMMIT."
  git merge-base --is-ancestor "$ARTIFACT_SOURCE_COMMIT" "$COMMIT" || fail 'The artifact source commit is not an ancestor of current origin/main; refusing to reuse artifacts from another line of history.'
  SOURCE_DIFF_FILES="$(git diff --name-only "$ARTIFACT_SOURCE_COMMIT" "$COMMIT")" || fail 'Could not compare the artifact source commit with current origin/main.'
  UNSAFE_SOURCE_DIFF=''
  if [[ -n "$SOURCE_DIFF_FILES" ]]; then
    UNSAFE_SOURCE_DIFF="$(printf '%s\n' "$SOURCE_DIFF_FILES" | grep -Ev '^(\.gitignore$|docs/|scripts/(publish-macos-release\.sh|release-tag-guard(\.test)?\.sh)$)' || true)"
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

EXPECTED_ASSETS="$(printf '%s\n%s\n' "$(basename "$ZIP")" "$(basename "$DMG")" | LC_ALL=C sort)"
RELEASE_MODE='create'
EXISTING_RELEASE="$(surffish_ghp release list --repo "$REPO" --json tagName --jq ".[] | select(.tagName == \"$TAG\") | .tagName")" || fail 'Could not check existing GitHub releases.'
if [[ -n "$EXISTING_RELEASE" ]]; then
  [[ "$EXISTING_RELEASE" == "$TAG" ]] || fail "A conflicting GitHub release entry exists for $TAG."
  RELEASE_MODE='reuse'
  verify_release_record
fi

printf '\n[release] Running typecheck and unit tests...\n'
bun run typecheck
bun run test
bash scripts/release-tag-guard.test.sh
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
if [[ -n "$STALE_INTEL" ]]; then
  printf '[release] Ignoring stale Intel artifact(s); only the validated ARM64 ZIP and DMG will be published:\n%s' "$STALE_INTEL"
fi

unzip -tq "$ZIP" >/dev/null || fail 'The ARM64 ZIP failed its integrity check.'
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/surffish-release.XXXXXX")"
ZIP_EXTRACT="$TEMP_DIR/zip"
REMOTE_ASSET_DIR="$TEMP_DIR/published-assets"
mkdir -p "$ZIP_EXTRACT" "$REMOTE_ASSET_DIR"
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

# Record non-cryptographic file identity before confirmation. The release checksum
# is deliberately calculated only after GitHub's published assets are verified.
ZIP_FINGERPRINT="$(stat -f '%z:%m:%i' "$ZIP")"
DMG_FINGERPRINT="$(stat -f '%z:%m:%i' "$DMG")"

printf '\n============================================================\n'
printf 'PUBLIC RELEASE CONFIRMATION — review every item below\n'
printf 'Repository: %s\nBranch: %s\nCurrent main commit: %s\nRelease tag commit: %s\nTag: %s\nTitle: %s\n' "$REPO" "$BRANCH" "$COMMIT" "$EXPECTED_TAG_COMMIT" "$TAG" "$TITLE"
if (( REUSE_EXISTING_ARTIFACTS )); then
  printf 'Artifact mode: reuse existing ARM64 ZIP and DMG (no packaging rebuild)\n'
  printf 'Declared artifact source commit: %s\n' "$ARTIFACT_SOURCE_COMMIT"
else
  printf 'Artifact mode: build ARM64 ZIP and DMG on this run\n'
fi
printf 'Pinned tag: already present and verified; this helper will not create, push, or alter it.\n'
printf 'Release mode: %s\n' "$RELEASE_MODE"
if [[ "$RELEASE_MODE" == 'reuse' ]]; then
  printf 'The matching public release already exists; it will be verified and reused, not replaced.\n'
else
  printf 'The public release will be created with exactly these two assets:\n'
fi
printf '  %s  (%s bytes)\n' "$(basename "$ZIP")" "$(stat -f '%z' "$ZIP")"
printf '  %s  (%s bytes)\n' "$(basename "$DMG")" "$(stat -f '%z' "$DMG")"
printf '\nRelease notes from %s:\n' "$NOTES_FILE"
printf '%s\n' '--------------------'
cat "$NOTES_FILE"
printf '%s\n' '--------------------'
printf '\nAfter release verification, the ZIP SHA-256 will be calculated, Casks/surffish.rb rendered, and only the Cask update pushed to main.\n'
printf 'No GitHub Actions workflow will be enabled or changed.\n\n'
[[ -r /dev/tty ]] || fail 'An interactive terminal is required for the publish confirmation.'
if (( REUSE_EXISTING_ARTIFACTS )); then
  printf '[release] The archives cannot prove their own source commit. Confirm that BOTH existing artifacts were built from the exact declared artifact source commit shown above.\n'
  read -r -p "Paste the full artifact source commit SHA $ARTIFACT_SOURCE_COMMIT to confirm: " ARTIFACT_SOURCE_CONFIRMATION </dev/tty
  [[ "$ARTIFACT_SOURCE_CONFIRMATION" == "$ARTIFACT_SOURCE_COMMIT" ]] || fail 'Artifact source commit confirmation did not match; nothing was published.'
fi
read -r -p 'Type PUBLISH v0.1.0 to create or resume the verified release, then update the Cask: ' CONFIRMATION </dev/tty
[[ "$CONFIRMATION" == "PUBLISH $TAG" ]] || fail 'Confirmation did not match; nothing was published.'

# Recheck mutable preconditions immediately before any external write.
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail 'Branch changed after the confirmation preview.'
[[ "$(git rev-parse HEAD)" == "$COMMIT" ]] || fail 'HEAD changed after the confirmation preview.'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'The worktree changed after the confirmation preview.'
REMOTE_MAIN="$(git ls-remote origin "refs/heads/$BRANCH" | awk 'NR == 1 {print $1}')"
[[ "$REMOTE_MAIN" == "$COMMIT" ]] || fail 'origin/main moved after the confirmation preview; nothing was published.'
surffish_validate_existing_tag "$TAG" "$EXPECTED_TAG_COMMIT" "$EXPECTED_TAG_OBJECT" origin || fail 'The pinned tag changed after the confirmation preview; it will not be repaired or repushed.'
[[ "$(stat -f '%z:%m:%i' "$ZIP")" == "$ZIP_FINGERPRINT" ]] || fail 'The ZIP changed after the confirmation preview; nothing was published.'
[[ "$(stat -f '%z:%m:%i' "$DMG")" == "$DMG_FINGERPRINT" ]] || fail 'The DMG changed after the confirmation preview; nothing was published.'

CURRENT_RELEASE="$(surffish_ghp release list --repo "$REPO" --json tagName --jq ".[] | select(.tagName == \"$TAG\") | .tagName")" || fail 'Could not recheck existing GitHub releases.'
if [[ "$RELEASE_MODE" == 'create' ]]; then
  [[ -z "$CURRENT_RELEASE" ]] || fail "GitHub release $TAG appeared after the preview; refusing to overwrite it. Re-run to inspect and resume only if it matches."
else
  [[ "$CURRENT_RELEASE" == "$TAG" ]] || fail "The previously verified GitHub release $TAG changed after the preview."
  verify_release_record
fi

PUBLISH_STARTED=1
if [[ "$RELEASE_MODE" == 'create' ]]; then
  printf '\n[release] Creating the public GitHub release with the two ARM64 assets...\n'
  surffish_ghp release create "$TAG" "$ZIP" "$DMG" \
    --repo "$REPO" \
    --title "$TITLE" \
    --notes-file "$NOTES_FILE" \
    --verify-tag
else
  printf '\n[release] Resuming with the existing matching release; no tag or release will be recreated.\n'
fi

verify_release_record
printf '[release] Downloading and comparing the published assets byte-for-byte...\n'
surffish_ghp release download "$TAG" --repo "$REPO" --dir "$REMOTE_ASSET_DIR"
DOWNLOADED_ASSETS="$(find "$REMOTE_ASSET_DIR" -maxdepth 1 -type f -print | sed 's#^.*/##' | LC_ALL=C sort)"
[[ "$DOWNLOADED_ASSETS" == "$EXPECTED_ASSETS" ]] || fail "Downloaded release assets did not match the two approved ARM64 files. Found:\n$DOWNLOADED_ASSETS"
cmp -s "$ZIP" "$REMOTE_ASSET_DIR/$(basename "$ZIP")" || fail 'The published ZIP does not match the validated local ARM64 ZIP.'
cmp -s "$DMG" "$REMOTE_ASSET_DIR/$(basename "$DMG")" || fail 'The published DMG does not match the validated local ARM64 DMG.'
printf '[release] Both published ARM64 assets are present and match the approved local files.\n'

# Compute the Homebrew checksum only after release metadata and both asset bytes
# have been verified successfully.
ZIP_SHA256="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
[[ "$ZIP_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail 'Could not calculate a valid ZIP SHA-256 checksum.'
printf '[release] Verified ZIP SHA-256: %s\n' "$ZIP_SHA256"
RENDERED_CASK="$TEMP_DIR/surffish.rb"
bun scripts/render-cask.ts \
  --version "$VERSION" \
  --sha256-arm64 "$ZIP_SHA256" \
  --out "$RENDERED_CASK"
grep -Fq "sha256 \"$ZIP_SHA256\"" "$RENDERED_CASK" || fail 'Rendered Cask does not contain the ZIP checksum.'

REMOTE_MAIN="$(git ls-remote origin "refs/heads/$BRANCH" | awk 'NR == 1 {print $1}')"
[[ "$REMOTE_MAIN" == "$COMMIT" ]] || fail 'origin/main moved while the release was being published; the release is intact, but the Cask update was not pushed.'
[[ "$(git rev-parse HEAD)" == "$COMMIT" ]] || fail 'Local HEAD changed while the release was being published; the release is intact, but the Cask update was not pushed.'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'The worktree changed while the release was being published; the Cask update was not pushed.'

printf '[release] Rendering and pushing the Cask update...\n'
if cmp -s "$RENDERED_CASK" Casks/surffish.rb; then
  printf '[release] Cask already matched the released ZIP checksum; no Cask commit was needed.\n'
else
  cp "$RENDERED_CASK" Casks/surffish.rb
  git add -- Casks/surffish.rb
  STAGED_FILES="$(git diff --cached --name-only)"
  [[ "$STAGED_FILES" == 'Casks/surffish.rb' ]] || fail "Refusing to commit unexpected staged files: $STAGED_FILES"
  git commit -m "chore(tap): update Surffish Cask to v${VERSION}"
  git push origin "$BRANCH"
fi

PUBLISH_STARTED=0
printf '\n[release] Complete: %s is published and verified; Casks/surffish.rb is current on %s.\n' "$TAG" "$BRANCH"
