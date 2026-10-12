#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/release-tag-guard.sh"

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/surffish-tag-guard.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
REMOTE="$TEST_DIR/remote.git"
WORK="$TEST_DIR/work"
TAG='v0.1.0'

fail_test() {
  printf '[tag-guard-test] FAIL: %s\n' "$*" >&2
  exit 1
}

git init --quiet --bare "$REMOTE"
git init --quiet "$WORK"
cd "$WORK"
git config user.name 'Surffish Tag Guard Test'
git config user.email 'tag-guard-test@example.invalid'
printf 'fixture\n' > fixture.txt
git add fixture.txt
git commit --quiet -m 'fixture commit'
EXPECTED_COMMIT="$(git rev-parse HEAD)"
git tag -a "$TAG" "$EXPECTED_COMMIT" -m 'Surffish 0.1.0 fixture tag'
EXPECTED_TAG_OBJECT="$(git rev-parse "refs/tags/$TAG")"
git remote add origin "$REMOTE"
git push --quiet origin "refs/tags/$TAG:refs/tags/$TAG"

surffish_validate_existing_tag "$TAG" "$EXPECTED_COMMIT" "$EXPECTED_TAG_OBJECT" origin || fail_test 'the exact local and remote annotated tag should be accepted'

if surffish_validate_existing_tag "$TAG" "$(printf '%040d' 0)" "$EXPECTED_TAG_OBJECT" origin 2>/dev/null; then
  fail_test 'a different expected target commit should be rejected'
fi

# Create a different annotated tag object with the same tag name and target, then
# put only that conflicting object on the remote. The guard must reject the drift.
git tag -f -a "$TAG" "$EXPECTED_COMMIT" -m 'conflicting tag object' >/dev/null
CONFLICTING_TAG_OBJECT="$(git rev-parse "refs/tags/$TAG")"
git push --quiet --force origin "refs/tags/$TAG:refs/tags/conflict"
git update-ref "refs/tags/$TAG" "$EXPECTED_TAG_OBJECT"
git --git-dir="$REMOTE" update-ref "refs/tags/$TAG" "$CONFLICTING_TAG_OBJECT"
git --git-dir="$REMOTE" update-ref -d refs/tags/conflict
if surffish_validate_existing_tag "$TAG" "$EXPECTED_COMMIT" "$EXPECTED_TAG_OBJECT" origin 2>/dev/null; then
  fail_test 'a remote tag object different from the pinned tag should be rejected'
fi

printf '[tag-guard-test] PASS: exact existing tag accepted; target and remote-object conflicts rejected.\n'
