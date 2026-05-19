"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProfileDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { UserCircle2 } from "lucide-react";
import { ApiError, patchJson } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { TooltipInfo } from "../../../components/ui/TooltipInfo";

interface ProfileSectionProps {
  profile: ProfileDto | null;
  onProfileUpdate: () => void;
  dict: AppDictionary;
}

export function ProfileSection({ profile, onProfileUpdate, dict }: ProfileSectionProps) {
  const [emailDraft, setEmailDraft] = useState(profile?.email ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [avatarImgError, setAvatarImgError] = useState(false);

  useEffect(() => {
    setEmailDraft(profile?.email ?? "");
  }, [profile?.email]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError("");
    setSaved(false);
    try {
      await patchJson("/profile", { email: emailDraft });
      setSaved(true);
      onProfileUpdate();
    } catch (error) {
      if (error instanceof ApiError && error.code === "impersonation_write_blocked") {
        return;
      }
      setError(dict.settings.profileEmailError);
    } finally {
      setIsSaving(false);
    }
  }, [emailDraft, dict.settings.profileEmailError, onProfileUpdate]);

  if (!profile) {
    return <p className="text-sm text-muted-foreground">{dict.feedback.loadingSettings}</p>;
  }

  const emailDirty = emailDraft !== (profile.email ?? "");

  return (
    <div className="space-y-5" data-testid="profile-section">
      <div className="flex items-center gap-4">
        {profile.providerPictureUrl && !avatarImgError ? (
          <img
            src={profile.providerPictureUrl}
            alt=""
            className="h-14 w-14 rounded-full object-cover"
            referrerPolicy="no-referrer"
            data-testid="profile-avatar-img"
            onError={() => setAvatarImgError(true)}
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserCircle2 className="h-7 w-7" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-foreground" data-testid="profile-display-name">
            {profile.displayName ?? "—"}
          </p>
          <p className="truncate text-sm text-muted-foreground" data-testid="profile-email-display">
            {profile.email ?? "—"}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">{dict.settings.profileDisplayNameLabel}</label>
            <TooltipInfo
              label={dict.settings.profileDisplayNameLabel}
              content={dict.settings.profileSyncedFromGoogle}
              triggerTestId="tooltip-profile-displayname-trigger"
              contentTestId="tooltip-profile-displayname-content"
            />
          </div>
          <input
            type="text"
            readOnly
            value={profile.displayName ?? ""}
            className={`${fieldClassName} mt-1 cursor-not-allowed opacity-60`}
            data-testid="profile-display-name-input"
          />
          <p className="mt-1 text-xs text-muted-foreground">{dict.settings.profileSyncedFromGoogle}</p>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">{dict.settings.profileEmailLabel}</label>
          <input
            type="email"
            value={emailDraft}
            onChange={(e) => {
              setEmailDraft(e.target.value);
              setSaved(false);
              setError("");
            }}
            className={`${fieldClassName} mt-1`}
            data-testid="profile-email-input"
          />
        </div>

        {error && (
          <p className="text-sm text-rose-600" data-testid="profile-email-error" role="alert">{error}</p>
        )}
        {saved && (
          <p className="text-sm text-emerald-600" data-testid="profile-email-saved" role="status">{dict.settings.profileEmailSaved}</p>
        )}

        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={!emailDirty || isSaving}
          onClick={handleSave}
          data-testid="profile-save-email"
        >
          {isSaving ? dict.settings.profileSavingEmail : dict.settings.profileSaveEmail}
        </Button>
      </div>
    </div>
  );
}
