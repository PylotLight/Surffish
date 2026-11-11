#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CEF_PROJECT_DIR="${CEF_PROJECT_DIR:-/tmp/surffish-cef-project}"
CEF_VERSION="156.0.27+ga10dae3+chromium-156.0.8078.88"
CEF_ROOT="${CEF_ROOT:-/dev/shm/surffish-cef-poc/cef_binary_${CEF_VERSION}_linux64_minimal}"
CEF_PROJECT_COMMIT="3aec7049cf63a36876d7a6ef538842d6af314482"

if [[ ! -d "$CEF_ROOT" || ! -f "$CEF_ROOT/CMakeLists.txt" ]]; then
  echo "CEF_ROOT must point to the extracted CEF 156 minimal distribution: $CEF_ROOT" >&2
  exit 1
fi
if [[ ! -d "$CEF_PROJECT_DIR/.git" ]]; then
  git clone https://github.com/chromiumembedded/cef-project.git "$CEF_PROJECT_DIR"
  git -C "$CEF_PROJECT_DIR" checkout "$CEF_PROJECT_COMMIT"
fi
actual_commit="$(git -C "$CEF_PROJECT_DIR" rev-parse HEAD)"
if [[ "$actual_commit" != "$CEF_PROJECT_COMMIT" ]]; then
  echo "Expected cef-project commit $CEF_PROJECT_COMMIT, found $actual_commit" >&2
  exit 1
fi

cp "$ROOT_DIR/poc/cef/cef-client-minimal.h" "$CEF_PROJECT_DIR/examples/minimal/client_minimal.h"
cp "$ROOT_DIR/poc/cef/cef-client-minimal.cc" "$CEF_PROJECT_DIR/examples/minimal/client_minimal.cc"
cp "$ROOT_DIR/poc/cef/cef-app-browser-minimal.cc" "$CEF_PROJECT_DIR/examples/minimal/app_browser_minimal.cc"
cp "$ROOT_DIR/poc/cef/cef-main-linux.cc" "$CEF_PROJECT_DIR/examples/shared/main_linux.cc"

python3 - "$CEF_PROJECT_DIR/CMakeLists.txt" "$CEF_PROJECT_DIR/examples/shared/browser_util.cc" "$CEF_VERSION" <<'PY'
import pathlib
import re
import sys

cmake_path = pathlib.Path(sys.argv[1])
browser_util_path = pathlib.Path(sys.argv[2])
version = sys.argv[3]

text = cmake_path.read_text()
new_version = f'set(CEF_VERSION "{version}")'
text, count = re.subn(r'^set\(CEF_VERSION "[^"]+"\)$', new_version, text, count=1, flags=re.MULTILINE)
if count == 0 and new_version not in text:
    raise SystemExit('Unexpected cef-project CMakeLists.txt version line')

start_marker = 'message(STATUS "Downloading clang-format from Google Storage...")'
end_marker = '\n\n\n#\n# Target configuration.\n#'
if start_marker in text:
    start = text.index(start_marker)
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit('Could not locate end of clang-format bootstrap section')
    replacement = 'message(STATUS "Skipping clang-format download in the isolated POC build.")'
    text = text[:start] + replacement + text[end:]
elif 'Skipping clang-format download in the isolated POC build.' not in text:
    raise SystemExit('Could not locate cef-project clang-format bootstrap section')

old_tests = '''add_subdirectory(${CEF_ROOT}/tests/cefclient)
add_subdirectory(${CEF_ROOT}/tests/cefsimple)
add_subdirectory(${CEF_ROOT}/tests/gtest)
add_subdirectory(${CEF_ROOT}/tests/ceftests)'''
new_tests = '''foreach(cef_test cefclient cefsimple gtest ceftests)
  if(EXISTS "${CEF_ROOT}/tests/${cef_test}/CMakeLists.txt")
    add_subdirectory(${CEF_ROOT}/tests/${cef_test})
  endif()
endforeach()'''
if old_tests in text:
    text = text.replace(old_tests, new_tests, 1)
elif new_tests not in text:
    raise SystemExit('Could not locate cef-project CEF test targets')
cmake_path.write_text(text)

browser_util = browser_util_path.read_text()
old_runtime = '''const auto runtime_style = IsAlloyStyleEnabled() ? CEF_RUNTIME_STYLE_ALLOY
                                                   : CEF_RUNTIME_STYLE_DEFAULT;'''
new_runtime = 'const auto runtime_style = CEF_RUNTIME_STYLE_CHROME;'
if old_runtime in browser_util:
    browser_util = browser_util.replace(old_runtime, new_runtime, 1)
elif new_runtime not in browser_util:
    raise SystemExit('Could not locate the cef-project browser runtime style selector')
browser_util_path.write_text(browser_util)
PY

link="$CEF_PROJECT_DIR/third_party/cef/cef_binary_${CEF_VERSION}_linux64"
mkdir -p "$(dirname "$link")"
if [[ -e "$link" && ! -L "$link" ]]; then
  echo "Refusing to replace non-symlink CEF directory: $link" >&2
  exit 1
fi
ln -sfn "$CEF_ROOT" "$link"

echo "Prepared isolated CEF project at $CEF_PROJECT_DIR"
echo "Pinned cef-project commit: $actual_commit"
echo "CEF version: $CEF_VERSION"
echo "CEF root: $CEF_ROOT"
echo "Chrome runtime style: explicit CEF_RUNTIME_STYLE_CHROME"
