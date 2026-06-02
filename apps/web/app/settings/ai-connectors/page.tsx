"use client";

import { SettingsSectionShell } from "../../../components/settings/SettingsSectionShell";
import { AiConnectorsSettingsClient } from "../../../components/settings/AiConnectorsSettingsClient";

export default function AiConnectorsSettingsPage() {
  return (
    <SettingsSectionShell portfolioConfigMode="lazy">
      <AiConnectorsSettingsClient />
    </SettingsSectionShell>
  );
}
