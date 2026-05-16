"use client";

import { SettingsSectionShell } from "../../../components/settings/SettingsSectionShell";
import { ProfileSettingsClient } from "../../../components/settings/ProfileSettingsClient";

export default function ProfileSettingsPage() {
  return (
    <SettingsSectionShell>
      <ProfileSettingsClient />
    </SettingsSectionShell>
  );
}
