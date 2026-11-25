#!/usr/bin/env bash
# Fake curl for scripts/github-api.test.ts: answers like the GitHub API and logs each
# call (method, url, proxy, auth) to a log file. Release existence is tracked by the
# presence of a "state" file (never its contents), so ONE curl handles the create /
# reuse-existing / 404 scenarios in sequence.
#
# The test copies this script to a temp dir, puts that dir on PATH, and sets
# FAKE_RELEASE_DIR to that dir so the log/state paths are deterministic regardless of
# how the binary was spawned ($0). The test touches the state file to simulate an
# existing release for the "reuse" scenario.
here="${FAKE_RELEASE_DIR:-${0%/*}}"
logFile="${here}/log"
state="${here}/state"
# A pre-existing (draft) release for tag v9, with no assets yet. Stored in a
# single-quoted variable so its brackets are untouched by the shell.
list_json='[{"tag_name":"v9","id":5,"draft":true,"assets":[]}]'
method=GET; url=""; proxy=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift;;
    --proxy) proxy="$2"; shift;;
    -o|-w|-H|--max-time|--config|--data-binary) shift;;
    -*) ;;
    *) url="$1";;
  esac
  shift
done
stdin="$(cat)"
echo "$method $url proxy=$proxy auth=$([[ "$stdin" == *"Bearer t0k"* ]] && echo yes || echo no)" >> "${logFile}"
# Existence of the state file means "a release for this tag already exists".
case "$method $url" in
  "GET https://api.github.com/repos/o/r/git/ref/tags/v9")
    printf '{"ref":"refs/tags/v9"}\n200';;
  "GET https://api.github.com/repos/o/r/git/ref/tags/v8")
    printf '{"message":"Not Found"}\n404';;
  "GET https://api.github.com/repos/o/r/releases?per_page=100")
    if [ -f "$state" ]; then printf "${list_json}\\n200"; else printf '[]\n200'; fi;;
  "POST https://api.github.com/repos/o/r/releases")
    if [ -f "$state" ]; then printf '{"id":5,"draft":true,"assets":[]}\n201'; else : > "$state"; printf '{"id":5,"draft":true,"assets":[]}\n201'; fi;;
  "POST https://uploads.github.com/repos/o/r/releases/5/assets?name=S.zip")
    if [ -f "$state" ]; then printf '{"name":"S.zip","size":3}\n201'; else : > "$state"; printf '{"name":"S.zip","size":3}\n201'; fi;;
  "PATCH https://api.github.com/repos/o/r/releases/5")
    printf '{"html_url":"https://github.com/o/r/releases/tag/v9"}\n200';;
  "GET https://api.github.com/repos/o/r/releases/5")
    if [ -f "$state" ]; then printf '{"assets":[{"name":"S.zip"}]}\n200'; else printf '{"assets":[]}\n200'; fi;;
  *)
    printf '{"message":"Not Found"}\n404';;
esac
