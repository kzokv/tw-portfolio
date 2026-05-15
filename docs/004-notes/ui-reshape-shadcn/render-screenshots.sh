#!/usr/bin/env bash
# Re-render mockup screenshots via headless Chrome.
# Run from worktree root.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="docs/004-notes/ui-reshape-shadcn"
BASE="file://$PWD/$DIR"
OUT="$DIR/screenshots"
mkdir -p "$OUT"

shots=(
  "01-dashboard-light.png|mockup-202605151210-dashboard.html|1440,900"
  "02-dashboard-dark.png|mockup-202605151210-dashboard.html?theme=dark|1440,900"
  "03-transactions-light.png|mockup-202605151211-transactions.html|1440,900"
  "04-transactions-dark.png|mockup-202605151211-transactions.html?theme=dark|1440,900"
  "05-public-share-light.png|mockup-202605151212-public-share.html|1280,900"
  "06-public-share-dark.png|mockup-202605151212-public-share.html?theme=dark|1280,900"
  "07-auth-login-light.png|mockup-202605151213-auth-login.html|1100,800"
  "08-auth-login-dark.png|mockup-202605151213-auth-login.html?theme=dark|1100,800"
  "09-settings-display-light.png|mockup-202605151214-settings-display.html|1440,900"
  "10-settings-display-dark.png|mockup-202605151214-settings-display.html?theme=dark|1440,900"
)

for entry in "${shots[@]}"; do
  IFS='|' read -r name url size <<< "$entry"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size="$size" \
    --screenshot="$OUT/$name" "$BASE/$url" 2>&1 | grep -E "bytes written" || true
done
echo "Done. See $OUT/"
