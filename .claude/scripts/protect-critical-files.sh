#!/bin/bash
# Block direct edits to critical files without explicit confirmation
# Protected: schema source of truth, auth modules, migration files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Normalize path separators
FILE_PATH=$(echo "$FILE_PATH" | sed 's|\\|/|g')

# Check against protected patterns
if echo "$FILE_PATH" | grep -qE '(packages/db/src/schema\.ts|drizzle/[0-9]+.*\.sql)'; then
  echo "BLOCKED: $FILE_PATH is a protected file (schema source of truth or migration)." >&2
  echo "Schema changes need careful review — run /plan-arch-review first." >&2
  exit 2
fi

exit 0
