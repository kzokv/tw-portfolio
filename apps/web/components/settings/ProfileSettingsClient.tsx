"use client";

import { useEffect, useState } from "react";
import type { ProfileDto } from "@vakwen/shared-types";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
import { useProfile } from "../../features/profile/hooks/useProfile";
import { ProfileSection } from "../../features/settings/components/ProfileSection";
import { useConfirmedSave } from "../../features/settings/hooks/useConfirmedSave";
import { patchProfile } from "../../features/settings/services/settingsService";
import { Button } from "../ui/Button";
import { fieldClassName } from "../ui/fieldStyles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/shadcn/dialog";

/**
 * Phase 3d S5 (A7) — `/settings/profile` body.
 *
 * Mounts `<ProfileSection>` verbatim per A6 (reskin deferred to Phase 7 prereq).
 * Adds two new editable fields ABOVE the existing email row:
 *
 *   - Display name (editable, confirmation-on-save)
 *   - Picture URL (editable, confirmation-on-save, HTTPS-only validation
 *     per `.claude/rules/provider-url-sanitization.md`)
 *
 * Both flows route through `useConfirmedSave` per A7 — sensitive fields
 * require explicit confirmation because the values are visible to share
 * collaborators and on inbound notifications.
 */
export function ProfileSettingsClient() {
  const { locale, profile: initialProfile } = useSettingsRouteContext();
  const dict = getDictionary(locale);
  const { profile, refresh } = useProfile(initialProfile);

  // Effective values from the resolver: user override wins, else provider value.
  const effectiveDisplayName =
    profile?.userDisplayName ?? profile?.displayName ?? "";
  const effectivePictureUrl =
    profile?.userPictureUrl ?? profile?.providerPictureUrl ?? "";

  const [displayNameDraft, setDisplayNameDraft] = useState(effectiveDisplayName);
  const [pictureUrlDraft, setPictureUrlDraft] = useState(effectivePictureUrl);

  // Reset drafts when the underlying profile changes (e.g. refresh after save).
  useEffect(() => {
    setDisplayNameDraft(effectiveDisplayName);
    setPictureUrlDraft(effectivePictureUrl);
  }, [effectiveDisplayName, effectivePictureUrl]);

  const displayNameSave = useConfirmedSave<string>({
    save: async (value) => {
      await patchProfile({ displayName: value.trim() === "" ? null : value.trim() });
      await refresh();
    },
  });

  const pictureUrlSave = useConfirmedSave<string>({
    save: async (value) => {
      const trimmed = value.trim();
      await patchProfile({ pictureUrl: trimmed === "" ? null : trimmed });
      await refresh();
    },
    validate: (value) => {
      const trimmed = value.trim();
      if (trimmed === "") return null; // empty = clear override (allowed)
      if (!trimmed.startsWith("https://")) {
        return dict.settings.profilePictureUrlInvalid;
      }
      return null;
    },
  });

  const displayNameDirty = displayNameDraft !== effectiveDisplayName;
  const pictureUrlDirty = pictureUrlDraft !== effectivePictureUrl;

  // Architect ruling (Item 2, locked) — Cancel REVERTS the local input
  // draft to the last persisted value (no PATCH, no draft retention).
  // Symmetric across display-name + picture-URL flows.
  function cancelDisplayNameEdit() {
    setDisplayNameDraft(effectiveDisplayName);
    displayNameSave.cancel();
  }
  function cancelPictureUrlEdit() {
    setPictureUrlDraft(effectivePictureUrl);
    pictureUrlSave.cancel();
  }

  return (
    <div className="space-y-6" data-testid="settings-section-profile">
      {/* Display-name + Picture URL — Phase 3d S5 (A7) */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground" htmlFor="profile-display-name-edit-input">
            {dict.settings.profileDisplayNameLabel}
          </label>
          <input
            id="profile-display-name-edit-input"
            type="text"
            maxLength={256}
            value={displayNameDraft}
            onChange={(event) => setDisplayNameDraft(event.target.value)}
            className={fieldClassName}
            data-testid="profile-display-name-edit-input"
          />
          <div className="pt-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={!displayNameDirty || displayNameSave.isSaving}
              onClick={() => displayNameSave.openConfirm(displayNameDraft)}
              data-testid="profile-display-name-save-button"
            >
              {dict.settings.profileConfirmSave}
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground" htmlFor="profile-picture-url-input">
            {dict.settings.profilePictureUrlLabel}
          </label>
          <input
            id="profile-picture-url-input"
            type="url"
            value={pictureUrlDraft}
            onChange={(event) => setPictureUrlDraft(event.target.value)}
            placeholder={dict.settings.profilePictureUrlPlaceholder}
            className={fieldClassName}
            data-testid="profile-picture-url-input"
          />
          {pictureUrlSave.hasError ? (
            <p className="text-xs text-rose-600" role="alert">{pictureUrlSave.error}</p>
          ) : null}
          <div className="pt-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={!pictureUrlDirty || pictureUrlSave.isSaving}
              onClick={() => pictureUrlSave.openConfirm(pictureUrlDraft)}
              data-testid="profile-picture-url-save-button"
            >
              {dict.settings.profileConfirmSave}
            </Button>
          </div>
        </div>
      </section>

      {/* Existing ProfileSection mounted verbatim per A6 — email row + avatar. */}
      <ProfileSection
        profile={profile as ProfileDto | null}
        onProfileUpdate={() => void refresh()}
        dict={dict}
      />

      {/* Confirmation: display name */}
      <Dialog
        open={displayNameSave.isConfirming}
        onOpenChange={(open) => {
          if (!open) cancelDisplayNameEdit();
        }}
      >
        <DialogContent data-testid="profile-confirm-dialog">
          <DialogHeader>
            <DialogTitle>{dict.settings.profileFieldChangeConfirmTitle}</DialogTitle>
            <DialogDescription>{dict.settings.profileFieldChangeConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={cancelDisplayNameEdit}
              data-testid="profile-confirm-dialog-cancel"
            >
              {dict.settings.profileConfirmCancel}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={() => void displayNameSave.confirm()}
              data-testid="profile-confirm-dialog-cta"
              disabled={displayNameSave.isSaving}
            >
              {dict.settings.profileConfirmSave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation: picture URL */}
      <Dialog
        open={pictureUrlSave.isConfirming}
        onOpenChange={(open) => {
          if (!open) cancelPictureUrlEdit();
        }}
      >
        <DialogContent data-testid="profile-picture-confirm-dialog">
          <DialogHeader>
            <DialogTitle>{dict.settings.profilePictureChangeConfirmTitle}</DialogTitle>
            <DialogDescription>{dict.settings.profilePictureChangeConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={cancelPictureUrlEdit}
              data-testid="profile-picture-confirm-dialog-cancel"
            >
              {dict.settings.profileConfirmCancel}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={() => void pictureUrlSave.confirm()}
              data-testid="profile-picture-confirm-dialog-cta"
              disabled={pictureUrlSave.isSaving}
            >
              {dict.settings.profileConfirmSave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
