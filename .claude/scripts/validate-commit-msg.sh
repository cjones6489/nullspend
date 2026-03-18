#!/bin/bash
# Validate conventional commit format: type(scope): description
# Types: feat, fix, chore, docs, refactor, test, perf, ci, style

COMMIT_MSG_FILE="$1"
COMMIT_MSG=$(head -1 "$COMMIT_MSG_FILE")

# Allow merge commits
if echo "$COMMIT_MSG" | grep -qE '^Merge '; then
  exit 0
fi

# Validate format: type[(scope)]: description
if ! echo "$COMMIT_MSG" | grep -qE '^(feat|fix|chore|docs|refactor|test|perf|ci|style)(\([a-z0-9-]+\))?: .+'; then
  echo "ERROR: Commit message must follow Conventional Commits format:" >&2
  echo "  type(scope): description" >&2
  echo "" >&2
  echo "Types: feat, fix, chore, docs, refactor, test, perf, ci, style" >&2
  echo "Scope is optional. Description must be present." >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  feat: add budget webhook notifications" >&2
  echo "  fix(proxy): handle streaming timeout correctly" >&2
  echo "  chore: update dependencies" >&2
  echo "" >&2
  echo "Your message: $COMMIT_MSG" >&2
  exit 1
fi

exit 0
