#!/usr/bin/env bash
# Re-render mockup screenshots via headless Chrome. Run from worktree root.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="docs/004-notes/ui-reshape-shadcn"
BASE="file://$PWD/$DIR"
OUT="$DIR/screenshots"
mkdir -p "$OUT"

shots=(
  # Original 5 surfaces — light + dark
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
  "11-dashboard-sidebar-collapsed.png|mockup-202605151210-dashboard.html?sidebar=collapsed|1440,900"
  "12-dashboard-profile-menu-open.png|mockup-202605151210-dashboard.html?menu=open|1440,900"
  # New pages — light by default
  "13-portfolio-light.png|mockup-202605151220-portfolio.html|1440,900"
  "14-portfolio-dark.png|mockup-202605151220-portfolio.html?theme=dark|1440,900"
  "15-cash-ledger-light.png|mockup-202605151221-cash-ledger.html|1440,900"
  "16-cash-ledger-dark.png|mockup-202605151221-cash-ledger.html?theme=dark|1440,900"
  "17-dividends-light.png|mockup-202605151222-dividends.html|1440,1100"
  "18-dividends-dark.png|mockup-202605151222-dividends.html?theme=dark|1440,1100"
  "19-sharing-light.png|mockup-202605151223-sharing.html|1440,900"
  "20-sharing-dark.png|mockup-202605151223-sharing.html?theme=dark|1440,900"
  "21-ticker-detail-light.png|mockup-202605151224-ticker-detail.html|1440,900"
  "22-ticker-detail-dark.png|mockup-202605151224-ticker-detail.html?theme=dark|1440,900"
  "23-invite-light.png|mockup-202605151225-invite.html|1100,800"
  "24-invite-dark.png|mockup-202605151225-invite.html?theme=dark|1100,800"
  "25-auth-error-light.png|mockup-202605151226-auth-error.html|1100,800"
  "26-auth-error-dark.png|mockup-202605151226-auth-error.html?theme=dark|1100,800"
  "27-admin-overview-light.png|mockup-202605151227-admin-overview.html|1440,900"
  "28-admin-overview-dark.png|mockup-202605151227-admin-overview.html?theme=dark|1440,900"
  "29-admin-settings-light.png|mockup-202605151228-admin-settings.html|1440,900"
  "30-admin-settings-dark.png|mockup-202605151228-admin-settings.html?theme=dark|1440,900"
  "31-admin-users-light.png|mockup-202605151229-admin-users.html|1440,900"
  "32-admin-users-dark.png|mockup-202605151229-admin-users.html?theme=dark|1440,900"
  "33-admin-instruments-light.png|mockup-202605151230-admin-instruments.html|1440,900"
  "34-admin-instruments-dark.png|mockup-202605151230-admin-instruments.html?theme=dark|1440,900"
  "35-admin-invites-light.png|mockup-202605151231-admin-invites.html|1440,900"
  "36-admin-invites-dark.png|mockup-202605151231-admin-invites.html?theme=dark|1440,900"
  "37-admin-providers-light.png|mockup-202605151232-admin-providers.html|1440,900"
  "38-admin-providers-dark.png|mockup-202605151232-admin-providers.html?theme=dark|1440,900"
  "39-admin-audit-log-light.png|mockup-202605151233-admin-audit-log.html|1440,900"
  "40-admin-audit-log-dark.png|mockup-202605151233-admin-audit-log.html?theme=dark|1440,900"
  "41-admin-provider-fixer-light.png|mockup-2026060209-admin-provider-fixer.html|1440,900"
  "42-admin-provider-fixer-dark.png|mockup-2026060209-admin-provider-fixer.html?theme=dark|1440,900"
)

for entry in "${shots[@]}"; do
  IFS='|' read -r name url size <<< "$entry"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size="$size" \
    --screenshot="$OUT/$name" "$BASE/$url" 2>&1 | grep -E "bytes written" || true
done
echo "Done. See $OUT/"
