"use client";

import { useCallback, useState } from "react";
import { resolveErrorMessage } from "../../../lib/utils";
import { toSaveSettingsRequest } from "../mappers/settingsMappers";
import { saveFullSettings } from "../services/settingsService";
import type { SettingsFormModel } from "../types/settingsUi";

interface UseSettingsSaveOptions {
  refresh: () => Promise<void>;
  closeDrawer: () => void;
}

export function useSettingsSave({ refresh, closeDrawer }: UseSettingsSaveOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const save = useCallback(async (model: SettingsFormModel) => {
    setIsSaving(true);
    setErrorMessage("");

    try {
      await saveFullSettings(toSaveSettingsRequest(model));
      closeDrawer();

      void refresh().catch((error) => {
        setErrorMessage(`Settings saved but dashboard refresh failed: ${resolveErrorMessage(error)}`);
      });
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }, [closeDrawer, refresh]);

  return {
    isSaving,
    errorMessage,
    setErrorMessage,
    save,
  };
}
