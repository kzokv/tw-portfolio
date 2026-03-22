import { Card } from "../../components/ui/Card";
import { buttonVariants } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { isValidReturnTo } from "../../lib/auth";
import { API_BASE } from "../../lib/api";
import { SignInButton } from "../../components/SignInButton";

interface Props {
  searchParams: Promise<{ returnTo?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { returnTo } = await searchParams;
  const validReturnTo = returnTo && isValidReturnTo(returnTo) ? returnTo : null;
  const signInHref = validReturnTo
    ? `${API_BASE}/auth/google/start?returnTo=${encodeURIComponent(validReturnTo)}`
    : `${API_BASE}/auth/google/start`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="flex w-full max-w-sm flex-col items-center gap-6 py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">TW Portfolio</h1>
          <p className="text-sm text-slate-500">Sign in to access your portfolio dashboard.</p>
        </div>
        <SignInButton
          href={signInHref}
          className={cn(buttonVariants({ variant: "default" }), "w-full")}
        />
      </Card>
    </main>
  );
}
