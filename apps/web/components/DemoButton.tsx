"use client";

import { useState } from "react";

interface DemoButtonProps {
  className?: string;
  label?: string;
  loadingLabel?: string;
  rateLimitedMessage?: string;
  fallbackErrorMessage?: string;
  networkErrorMessage?: string;
}

export function DemoButton({
  className,
  label = "Try it - no sign-up needed",
  loadingLabel = "Starting demo...",
  rateLimitedMessage = "Too many demo sessions. Please wait a minute and try again.",
  fallbackErrorMessage = "Failed to start demo session.",
  networkErrorMessage = "Cannot reach the server. Please try again.",
}: DemoButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setLoading(true);
    try {
      sessionStorage.setItem("isDemo", "true");
      const res = await fetch("/api/demo/start", { method: "POST" });
      if (!res.ok) {
        sessionStorage.removeItem("isDemo");
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(rateLimitedMessage);
        } else {
          setError(body.error ?? fallbackErrorMessage);
        }
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      sessionStorage.removeItem("isDemo");
      setError(networkErrorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        data-testid="demo-sign-in-button"
        className={className}
      >
        {loading ? loadingLabel : label}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
