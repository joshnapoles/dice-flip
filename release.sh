#!/usr/bin/env bash
# release.sh — publish npm package, push to git, deploy static demo
# Usage: npm run release
set -e

VERSION=$(node -e "process.stdout.write(require('./package.json').version)")

echo "▶ Building library…"
npm run build

echo "▶ Publishing v${VERSION} to npm…"
npm publish

echo "▶ Committing and pushing to git…"
git add -A
git commit -m "chore: release v${VERSION}"
git push origin main

echo "▶ Deploying static demo…"
npm run deploy

echo "✓ Released v${VERSION}"
