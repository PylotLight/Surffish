#!/usr/bin/env bash

# Invoke the user's Fish ghp function after loading their configured functions.
# The argument list is escaped as Fish source before eval so spaces, quotes,
# wildcard characters, and jq expressions remain individual literal arguments.
surffish_ghp() {
  local fish_config="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"

  if ! command -v fish >/dev/null 2>&1; then
    printf '[release] ERROR: Required command not found: fish\n' >&2
    return 127
  fi
  if [[ ! -r "$fish_config" ]]; then
    printf '[release] ERROR: Fish config is not readable: %s\n' "$fish_config" >&2
    return 1
  fi

  fish --no-config -c '
    source "$argv[1]" >/dev/null
    or exit $status
    set -l escaped_args (string escape -- $argv[2..-1] | string join " ")
    eval "ghp $escaped_args"
  ' "$fish_config" "$@"
}
