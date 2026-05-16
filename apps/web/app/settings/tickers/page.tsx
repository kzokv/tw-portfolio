"use client";

import { SettingsSectionShell } from "../../../components/settings/SettingsSectionShell";
import { TickersSettingsClient } from "../../../components/settings/TickersSettingsClient";

export default function TickersSettingsPage() {
  return (
    <SettingsSectionShell>
      <TickersSettingsClient />
    </SettingsSectionShell>
  );
}
