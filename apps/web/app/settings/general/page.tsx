"use client";

import { SettingsSectionShell } from "../../../components/settings/SettingsSectionShell";
import { GeneralSettingsClient } from "../../../components/settings/GeneralSettingsClient";

export default function GeneralSettingsPage() {
  return (
    <SettingsSectionShell>
      <GeneralSettingsClient />
    </SettingsSectionShell>
  );
}
