"use client";

import { SettingsSectionShell } from "../../../components/settings/SettingsSectionShell";
import { AiConnectorsSettingsClient } from "../../../components/settings/AiConnectorsSettingsClient";

export default function AiConnectorsSettingsPage() {
  return (
    <SettingsSectionShell>
      <AiConnectorsSettingsClient />
    </SettingsSectionShell>
  );
}
