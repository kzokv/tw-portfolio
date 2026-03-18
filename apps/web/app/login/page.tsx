"use client";

import { Card } from "../../components/ui/Card";
import { buttonVariants } from "../../components/ui/Button";
import { API_BASE } from "../../lib/api";
import { cn } from "../../lib/utils";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="flex w-full max-w-sm flex-col items-center gap-6 py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">TW Portfolio</h1>
          <p className="text-sm text-slate-500">Sign in to access your portfolio dashboard.</p>
        </div>
        <a
          href={`${API_BASE}/auth/google/start`}
          suppressHydrationWarning
          onClick={(e) => {
            e.preventDefault();
            window.location.href = `${API_BASE}/auth/google/start`;
          }}
          data-testid="google-sign-in-button"
          className={cn(buttonVariants({ variant: "default" }), "w-full")}
        >
          Sign in with Google
        </a>
      </Card>
    </main>
  );
}
