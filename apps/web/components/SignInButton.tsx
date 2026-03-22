"use client";

import { useState } from "react";
import { API_BASE } from "../lib/api";

interface SignInButtonProps {
  href: string;
  className?: string;
}

export function SignInButton({ href, className }: SignInButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await fetch(`${API_BASE}/health/live`, {
        signal: AbortSignal.timeout(3000),
      });
      window.location.href = href;
    } catch {
      setError(
        "Cannot reach the API server. If your API runs in a Docker container, create an SSH tunnel forwarding the API port (e.g. -L 4300:192.168.64.1:4300 — replace the IP with your Docker host IP).",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <a
        href={href}
        onClick={handleClick}
        data-testid="google-sign-in-button"
        className={className}
        aria-disabled={loading || undefined}
      >
        {loading ? "Connecting…" : "Sign in with Google"}
      </a>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
