"use client";

import { useState } from "react";

interface DemoButtonProps {
  className?: string;
}

export function DemoButton({ className }: DemoButtonProps) {
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
          setError("Too many demo sessions. Please wait a minute and try again.");
        } else {
          setError(body.error ?? "Failed to start demo session.");
        }
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      sessionStorage.removeItem("isDemo");
      setError("Cannot reach the server. Please try again.");
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
        {loading ? "Starting demo..." : "Try it \u2014 no sign-up needed"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
