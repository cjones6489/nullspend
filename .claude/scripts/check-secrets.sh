#!/bin/bash
# Pre-commit secret scanning — catches accidental leaks in staged files
# Patterns: API keys, tokens, connection strings, private keys

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.command // ""')

# Only check source files, not binaries or lock files
if echo "$FILE_PATH" | grep -qE '\.(ts|tsx|js|jsx|json|md|sh|sql|css|env)$'; then
  if [ -f "$FILE_PATH" ]; then
    # Check for common secret patterns
    MATCHES=$(grep -nE \
      '(sk-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (RSA |EC |DSA )?PRIVATE KEY|password\s*[:=]\s*["\x27][^"\x27]{8,}|postgresql://[^@]+:[^@]+@|redis://[^@]*:[^@]+@|SUPABASE_SERVICE_ROLE_KEY\s*=\s*ey)' \
      "$FILE_PATH" 2>/dev/null || true)

    if [ -n "$MATCHES" ]; then
      echo "BLOCKED: Potential secret detected in $FILE_PATH:" >&2
      echo "$MATCHES" >&2
      echo "If this is intentional (e.g., a test fixture), ask the user to confirm." >&2
      exit 2
    fi
  fi
fi

exit 0
