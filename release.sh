#!/usr/bin/env bash
# release.sh — full release: version bump, README reminder, publish, git push, deploy
#
# Usage:
#   npm run release              → interactive (prompts for bump type & commit msg)
#   npm run release -- patch     → automatic patch bump
#   npm run release -- minor     → automatic minor bump
#   npm run release -- major     → automatic major bump
#
# An agent should:
#   1. Update README.md and stage any other changes
#   2. Run `npm run release -- <patch|minor|major>`
set -e

BUMP=${1:-""}

# ── 1. README reminder ────────────────────────────────────────────────────────
echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  PRE-RELEASE CHECKLIST                              │"
echo "│                                                     │"
echo "│  ☐  README.md updated with changes                 │"
echo "│  ☐  All local changes staged / committed           │"
echo "└─────────────────────────────────────────────────────┘"
echo ""

if [[ -z "$BUMP" ]]; then
  read -r -p "README updated? Proceed with release? (y/N) " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# ── 2. Version bump ───────────────────────────────────────────────────────────
if [[ -z "$BUMP" ]]; then
  echo ""
  read -r -p "Version bump [patch / minor / major]: " BUMP
fi

OLD_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
npm version "$BUMP" --no-git-tag-version
NEW_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
echo "▶ Bumped $OLD_VERSION → $NEW_VERSION"

# ── 3. Build & publish ────────────────────────────────────────────────────────
echo "▶ Building library…"
npm run build

echo "▶ Publishing v${NEW_VERSION} to npm…"
npm publish

# ── 4. Commit & push ──────────────────────────────────────────────────────────
echo "▶ Committing and pushing to git…"
git add -A
git commit -m "chore: release v${NEW_VERSION}"
git push origin main

# ── 5. Deploy static demo ─────────────────────────────────────────────────────
echo "▶ Deploying static demo…"
npm run deploy

echo ""
echo "✓ Released v${NEW_VERSION}"
