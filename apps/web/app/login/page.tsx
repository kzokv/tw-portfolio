import { buttonVariants } from "../../components/ui/Button";
import { AuthShell } from "../../components/layout/AuthShell";
import { cn } from "../../lib/utils";
import { isValidReturnTo } from "../../lib/auth";
import { API_PUBLIC } from "../../lib/api";
import { SignInButton } from "../../components/SignInButton";
import { DemoButton } from "../../components/DemoButton";
import { WebEnv } from "@vakwen/config/web";

interface Props {
  searchParams: Promise<{ returnTo?: string; demoExpired?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { returnTo, demoExpired } = await searchParams;
  const validReturnTo = returnTo && isValidReturnTo(returnTo) ? returnTo : null;
  const signInHref = validReturnTo
    ? `${API_PUBLIC}/auth/google/start?returnTo=${encodeURIComponent(validReturnTo)}`
    : `${API_PUBLIC}/auth/google/start`;
  const showDemo = WebEnv.DEMO_MODE_ENABLED === "true";

  return (
    <AuthShell cardClassName="flex flex-col items-center gap-6 py-10">
      {demoExpired && (
        <p className="text-sm text-amber-700" role="status">
          Your demo session has ended. Sign in to keep your data.
        </p>
      )}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Vakwen</h1>
        <p className="text-sm text-muted-foreground">Sign in to access your portfolio dashboard.</p>
      </div>
      <SignInButton
        href={signInHref}
        className={cn(buttonVariants({ variant: "default" }), "w-full")}
      />
      {showDemo && (
        <>
          <div className="flex w-full items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <DemoButton className={cn(buttonVariants({ variant: "secondary" }), "w-full")} />
        </>
      )}
    </AuthShell>
  );
}
