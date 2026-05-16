"use client";

import { SettingsSectionShell } from "../../../components/settings/SettingsSectionShell";
import { AccountsSettingsClient } from "../../../components/settings/AccountsSettingsClient";

export default function AccountsSettingsPage() {
  return (
    <SettingsSectionShell>
      <AccountsSettingsClient />
    </SettingsSectionShell>
  );
}
