#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/fish-ghp.sh"

fail_test() {
  printf '[fish-ghp-test] FAIL: %s\n' "$*" >&2
  exit 1
}

command -v fish >/dev/null 2>&1 || fail_test 'Fish is required to run this test.'
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/surffish-fish-ghp.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/fish"
export XDG_CONFIG_HOME="$TEST_DIR"

cat > "$TEST_DIR/fish/config.fish" <<'FISH'
printf 'Fish config startup chatter that must not pollute CLI output.\n'
function ghp
  set -l expected
  set -l output
  if test "$argv[1]" = release; and test "$argv[2]" = list
    set expected 'release' 'list' '--repo' 'PylotLight/Surffish' '--json' 'tagName' '--jq' '.[] | select(.tagName == "v0.1.0") | .tagName'
    set output '{"tagName":"v0.1.0"}'
  else if test "$argv[1]" = release; and test "$argv[2]" = create
    set expected 'release' 'create' 'v0.1.0' '/tmp/notes with spaces and "quotes".md' '/tmp/archive *.zip' '--repo' 'PylotLight/Surffish' '--title' 'Surffish 0.1.0 — Security and Session Privacy' '--notes-file' '/tmp/notes with spaces and "quotes".md' '--verify-tag'
    set output '{"url":"https://example.invalid/release"}'
  else
    printf '[fish-ghp-test] Unexpected ghp command.\n' >&2
    return 64
  end

  if test (count $argv) -ne (count $expected)
    printf '[fish-ghp-test] Argument count mismatch: expected %s, got %s.\n' (count $expected) (count $argv) >&2
    return 64
  end
  for index in (seq (count $expected))
    if test "$argv[$index]" != "$expected[$index]"
      printf '[fish-ghp-test] Argument %s mismatch.\n' "$index" >&2
      return 64
    end
  end
  printf '%s\n' "$output"
end
FISH

list_output="$(surffish_ghp release list --repo 'PylotLight/Surffish' --json tagName --jq '.[] | select(.tagName == "v0.1.0") | .tagName')" || fail_test 'ghp list invocation failed.'
[[ "$list_output" == '{"tagName":"v0.1.0"}' ]] || fail_test "JSON stdout was not preserved exactly: $list_output"

create_output="$(surffish_ghp release create 'v0.1.0' '/tmp/notes with spaces and "quotes".md' '/tmp/archive *.zip' --repo 'PylotLight/Surffish' --title 'Surffish 0.1.0 — Security and Session Privacy' --notes-file '/tmp/notes with spaces and "quotes".md' --verify-tag)" || fail_test 'ghp create invocation failed.'
[[ "$create_output" == '{"url":"https://example.invalid/release"}' ]] || fail_test "JSON stdout was not preserved exactly: $create_output"

printf '[fish-ghp-test] PASS: jq expression, spaced/quoted paths, wildcard characters, and JSON stdout preserved.\n'
