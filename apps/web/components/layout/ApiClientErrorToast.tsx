"use client";

import { useEffect, useRef, useState } from "react";
import { API_CLIENT_ERROR_EVENT, type ApiClientErrorDetail } from "../../lib/api";
import { StatusToast } from "../ui/StatusToast";

const TOAST_CLEAR_DELAY_MS = 5000;
const DEFAULT_IMPERSONATION_BLOCKED_MESSAGE = "Writes are disabled while impersonating. Exit impersonation to make changes.";

export function ApiClientErrorToast() {
  const [message, setMessage] = useState("");
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClientError(event: Event): void {
      const detail = (event as CustomEvent<ApiClientErrorDetail>).detail;
      const resolvedMessage = detail.code === "impersonation_write_blocked"
        ? DEFAULT_IMPERSONATION_BLOCKED_MESSAGE
        : detail.message;

      setMessage(resolvedMessage);

      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current);
      }
      clearTimeoutRef.current = setTimeout(() => {
        setMessage("");
        clearTimeoutRef.current = null;
      }, TOAST_CLEAR_DELAY_MS);
    }

    window.addEventListener(API_CLIENT_ERROR_EVENT, handleClientError);
    return () => {
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current);
      }
      window.removeEventListener(API_CLIENT_ERROR_EVENT, handleClientError);
    };
  }, []);

  return <StatusToast message={message} variant="error" testId="client-api-error" />;
}
