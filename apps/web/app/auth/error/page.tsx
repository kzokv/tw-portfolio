import Link from "next/link";
import { Card } from "../../../components/ui/Card";
import { buttonVariants } from "../../../components/ui/Button";
import { cn } from "../../../lib/utils";

const REASON_MESSAGES: Record<string, { title: string; description: string; linkText?: string }> = {
  invalid_state: {
    title: "Sign-in failed",
    description: "The sign-in request was invalid or expired. Please try again.",
  },
  oauth_error: {
    title: "Sign-in cancelled",
    description: "Google reported an error during sign-in. Please try again.",
  },
  server_error: {
    title: "Something went wrong",
    description: "A server error occurred during sign-in. Please try again in a moment.",
  },
  session_expired: {
    title: "Your session has expired",
    description: "Please sign in again to continue.",
    linkText: "Sign in again",
  },
};

const DEFAULT_MESSAGE: { title: string; description: string; linkText?: string } = {
  title: "Sign-in failed",
  description: "An unexpected error occurred during sign-in. Please try again.",
};

interface Props {
  searchParams: Promise<{ reason?: string }>;
}

export default async function AuthErrorPage({ searchParams }: Props) {
  const { reason } = await searchParams;
  const message = (reason ? REASON_MESSAGES[reason] : undefined) ?? DEFAULT_MESSAGE;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="flex w-full max-w-sm flex-col items-center gap-6 py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">{message.title}</h1>
          <p className="text-sm text-slate-500">{message.description}</p>
        </div>
        <Link
          href="/login"
          data-testid="auth-error-try-again"
          className={cn(buttonVariants({ variant: "default" }), "w-full")}
        >
          {message.linkText ?? "Try again"}
        </Link>
      </Card>
    </main>
  );
}
