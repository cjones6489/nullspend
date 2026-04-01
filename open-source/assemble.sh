#!/usr/bin/env bash
set -euo pipefail

# Assemble the public NullSpend repo from the private monorepo.
# Run from the monorepo root: bash open-source/assemble.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC="$MONOREPO/../nullspend-public"

if [ -d "$PUBLIC" ]; then
  echo "Error: $PUBLIC already exists. Remove it first."
  exit 1
fi

echo "==> Creating public repo at $PUBLIC"
mkdir -p "$PUBLIC"

# ── Copy packages ──────────────────────────────────────────────
echo "==> Copying packages..."
mkdir -p "$PUBLIC/packages"
for pkg in sdk sdk-python cost-engine claude-agent mcp-server mcp-proxy docs-mcp-server db; do
  cp -r "$MONOREPO/packages/$pkg" "$PUBLIC/packages/$pkg"
done

# ── Copy proxy ─────────────────────────────────────────────────
echo "==> Copying proxy..."
mkdir -p "$PUBLIC/apps"
cp -r "$MONOREPO/apps/proxy" "$PUBLIC/apps/proxy"

# ── Copy docs (minus internal/) ────────────────────────────────
echo "==> Copying docs (excluding internal/)..."
mkdir -p "$PUBLIC/docs"
find "$MONOREPO/docs" -mindepth 1 -maxdepth 1 -not -name "internal" -exec cp -r {} "$PUBLIC/docs/" \;

# ── Copy config files ──────────────────────────────────────────
echo "==> Copying config files..."
cp "$MONOREPO/.npmrc" "$PUBLIC/.npmrc"
cp "$MONOREPO/pnpm-workspace.yaml" "$PUBLIC/pnpm-workspace.yaml"

# ── Copy llms.txt ──────────────────────────────────────────────
echo "==> Copying llms.txt..."
cp "$MONOREPO/public/llms.txt" "$PUBLIC/llms.txt"

# ── Copy public-repo-only files ────────────────────────────────
echo "==> Copying public repo files..."
cp "$SCRIPT_DIR/LICENSE" "$PUBLIC/LICENSE"
cp "$SCRIPT_DIR/README.md" "$PUBLIC/README.md"
cp "$SCRIPT_DIR/CONTRIBUTING.md" "$PUBLIC/CONTRIBUTING.md"
cp "$SCRIPT_DIR/CODE_OF_CONDUCT.md" "$PUBLIC/CODE_OF_CONDUCT.md"
cp "$SCRIPT_DIR/SECURITY.md" "$PUBLIC/SECURITY.md"
cp "$SCRIPT_DIR/package.json" "$PUBLIC/package.json"
cp "$SCRIPT_DIR/.gitignore" "$PUBLIC/.gitignore"
cp "$SCRIPT_DIR/eslint.config.mjs" "$PUBLIC/eslint.config.mjs"
cp -r "$SCRIPT_DIR/.github" "$PUBLIC/.github"

# ── Clean up build artifacts and env files ─────────────────────
echo "==> Cleaning up artifacts..."
find "$PUBLIC" -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find "$PUBLIC" -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
find "$PUBLIC" -name ".wrangler" -type d -exec rm -rf {} + 2>/dev/null || true
find "$PUBLIC" -name ".env" -type f -delete 2>/dev/null || true
find "$PUBLIC" -name ".env.local" -type f -delete 2>/dev/null || true
find "$PUBLIC" -name ".env.smoke" -type f -delete 2>/dev/null || true
find "$PUBLIC" -name ".dev.vars" -type f -delete 2>/dev/null || true
find "$PUBLIC" -name ".dev.vars.local" -type f -delete 2>/dev/null || true
find "$PUBLIC" -name "worker-configuration.d.ts" -type f -delete 2>/dev/null || true

# ── Generate lockfile for reproducible CI builds ──────────────
echo "==> Generating lockfile..."
(cd "$PUBLIC" && pnpm install --lockfile-only)

# ── Verification ───────────────────────────────────────────────
echo ""
echo "==> Verification checks:"

# No dashboard code
if [ -d "$PUBLIC/app" ] || [ -d "$PUBLIC/components" ] || [ -d "$PUBLIC/lib" ]; then
  echo "  FAIL: Dashboard code leaked (app/, components/, or lib/ exists)"
  exit 1
else
  echo "  OK: No dashboard code"
fi

# No internal docs
if [ -d "$PUBLIC/docs/internal" ]; then
  echo "  FAIL: Internal docs leaked"
  exit 1
else
  echo "  OK: No internal docs"
fi

# LICENSE exists
if [ -f "$PUBLIC/LICENSE" ]; then
  echo "  OK: LICENSE exists"
else
  echo "  FAIL: LICENSE missing"
  exit 1
fi

# Check for personal refs
if grep -r "cjones6489" "$PUBLIC" --include="*.ts" --include="*.json" --include="*.md" --include="*.toml" -l 2>/dev/null; then
  echo "  WARN: Found personal references (cjones6489) in files above"
else
  echo "  OK: No personal references"
fi

# Check for hardcoded secrets pattern
if grep -r "ns_live_sk_[a-zA-Z0-9]" "$PUBLIC" --include="*.ts" --include="*.json" -l 2>/dev/null; then
  echo "  WARN: Possible hardcoded API keys found in files above"
else
  echo "  OK: No hardcoded API keys"
fi

echo ""
echo "==> Public repo assembled at $PUBLIC"
echo ""
echo "Next steps:"
echo "  cd $PUBLIC"
echo "  git init"
echo "  git add -A"
echo "  git commit -m 'Initial open-source release'"
echo "  git remote add origin https://github.com/NullSpend/nullspend.git"
echo "  git push -u origin main"
