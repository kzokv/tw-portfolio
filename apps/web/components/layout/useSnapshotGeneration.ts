"use client";

import { useCallback, useState } from "react";
import type { SnapshotsGeneratedEvent } from "@vakwen/shared-types";
import { postJson } from "../../lib/api";
import type { AppDictionary } from "../../lib/i18n/types";

interface UseSnapshotGenerationOptions {
  dict: AppDictionary;
  /** Called after a successful snapshot generation to bump context refresh. */
  onSuccess: () => void;
}

/**
 * Owns the snapshot-generation state previously inlined in `AppShell.tsx`:
 * the in-flight flag, the success / failure status message, the
 * `handleSnapshotsGenerated` SSE handler, and the `generateSnapshots`
 * trigger. Extracted per Phase 3c spec target (AppShell ≤300 LOC).
 */
export function useSnapshotGeneration({ dict, onSuccess }: UseSnapshotGenerationOptions) {
  const [isGeneratingSnapshots, setIsGeneratingSnapshots] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState("");

  const handleSnapshotsGenerated = useCallback(
    (event: SnapshotsGeneratedEvent) => {
      setIsGeneratingSnapshots(false);
      if (event.status === "error") {
        setSnapshotMessage(
          dict.dashboardHome.snapshotsGenerationFailed.replace("{error}", event.error ?? ""),
        );
        return;
      }
      setSnapshotMessage(
        dict.dashboardHome.snapshotsGeneratedMessage
          .replace("{totalRows}", String(event.totalRows))
          .replace("{provisionalRows}", String(event.provisionalRows)),
      );
      onSuccess();
    },
    [
      dict.dashboardHome.snapshotsGeneratedMessage,
      dict.dashboardHome.snapshotsGenerationFailed,
      onSuccess,
    ],
  );

  const generateSnapshots = useCallback(async () => {
    setIsGeneratingSnapshots(true);
    setSnapshotMessage("");
    try {
      await postJson("/portfolio/snapshots/generate", {});
    } catch {
      setIsGeneratingSnapshots(false);
      setSnapshotMessage("");
    }
  }, []);

  return {
    isGeneratingSnapshots,
    snapshotMessage,
    handleSnapshotsGenerated,
    generateSnapshots,
  };
}
