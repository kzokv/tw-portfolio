"use client";

import type { ProfileDto } from "@vakwen/shared-types";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
import { useProfile } from "../../features/profile/hooks/useProfile";
import { ProfileSection } from "../../features/settings/components/ProfileSection";

/**
 * `/settings/profile` body.
 *
 * The Display Name + Picture URL editable card was dropped on 2026-05-17
 * (user request — Display Name is sourced from Google, Picture URL was
 * deemed not-needed). The legacy `<ProfileSection>` (read-only Display
 * Name + Email) is the canonical surface.
 */
export function ProfileSettingsClient() {
  const { locale, profile: initialProfile } = useSettingsRouteContext();
  const dict = getDictionary(locale);
  const { profile, refresh } = useProfile(initialProfile);

  return (
    <div className="space-y-6" data-testid="settings-section-profile">
      <ProfileSection
        profile={profile as ProfileDto | null}
        onProfileUpdate={() => void refresh()}
        dict={dict}
      />
    </div>
  );
}
