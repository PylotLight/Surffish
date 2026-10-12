#!/usr/bin/env bash

# Validate that an already-published annotated tag is the exact expected tag.
# This function is intentionally read-only: it never creates, moves, or pushes tags.
surffish_validate_existing_tag() {
  local tag_name="$1"
  local expected_commit="$2"
  local expected_tag_object="$3"
  local remote="$4"
  local local_ref="refs/tags/$tag_name"
  local remote_ref="refs/tags/$tag_name"
  local peeled_ref="refs/tags/$tag_name^{}"
  local local_type
  local local_object
  local local_commit
  local remote_rows
  local remote_object
  local remote_commit
  local direct_count
  local peeled_count

  if ! git show-ref --verify --quiet "$local_ref"; then
    printf '[release] ERROR: Required local tag %s is missing; refusing to create or repair it.\n' "$tag_name" >&2
    return 1
  fi

  local_type="$(git cat-file -t "$local_ref" 2>/dev/null)" || {
    printf '[release] ERROR: Could not inspect local tag %s.\n' "$tag_name" >&2
    return 1
  }
  if [[ "$local_type" != 'tag' ]]; then
    printf '[release] ERROR: Local tag %s is not an annotated tag.\n' "$tag_name" >&2
    return 1
  fi

  local_object="$(git rev-parse --verify "$local_ref" 2>/dev/null)" || return 1
  if [[ "$local_object" != "$expected_tag_object" ]]; then
    printf '[release] ERROR: Local tag %s is not the expected tag object; refusing to rewrite or publish it.\n' "$tag_name" >&2
    return 1
  fi

  local_commit="$(git rev-parse --verify "${local_ref}^{commit}" 2>/dev/null)" || return 1
  if [[ "$local_commit" != "$expected_commit" ]]; then
    printf '[release] ERROR: Local tag %s points to %s, not the expected commit %s.\n' "$tag_name" "$local_commit" "$expected_commit" >&2
    return 1
  fi

  remote_rows="$(git ls-remote --tags "$remote" "$remote_ref" "$peeled_ref")" || {
    printf '[release] ERROR: Could not verify remote tag %s on %s.\n' "$tag_name" "$remote" >&2
    return 1
  }
  direct_count="$(printf '%s\n' "$remote_rows" | awk -v ref="$remote_ref" '$2 == ref { n++ } END { print n + 0 }')"
  peeled_count="$(printf '%s\n' "$remote_rows" | awk -v ref="$peeled_ref" '$2 == ref { n++ } END { print n + 0 }')"
  if [[ "$direct_count" != '1' || "$peeled_count" != '1' ]]; then
    printf '[release] ERROR: Remote tag %s is missing, lightweight, or ambiguous; refusing to create or repair it.\n' "$tag_name" >&2
    return 1
  fi

  remote_object="$(printf '%s\n' "$remote_rows" | awk -v ref="$remote_ref" '$2 == ref { print $1 }')"
  remote_commit="$(printf '%s\n' "$remote_rows" | awk -v ref="$peeled_ref" '$2 == ref { print $1 }')"
  if [[ "$remote_object" != "$expected_tag_object" || "$remote_commit" != "$expected_commit" ]]; then
    printf '[release] ERROR: Remote tag %s conflicts with the expected annotated tag object or target commit.\n' "$tag_name" >&2
    return 1
  fi

  return 0
}
