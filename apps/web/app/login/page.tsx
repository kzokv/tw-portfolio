import { buttonVariants } from "../../components/ui/Button";
import { AuthShell } from "../../components/layout/AuthShell";
import { cn } from "../../lib/utils";
import { isValidReturnTo } from "../../lib/auth";
import { API_PUBLIC } from "../../lib/api";
import { SignInButton } from "../../components/SignInButton";
import { DemoButton } from "../../components/DemoButton";
import { authPageCopy, resolveAuthLocale } from "../../lib/authPages";
import { WebEnv } from "@vakwen/config/web";
import Link from "next/link";
import { headers } from "next/headers";

interface Props {
  searchParams: Promise<{ returnTo?: string; demoExpired?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { returnTo, demoExpired } = await searchParams;
  const headerStore = await headers();
  const copy = authPageCopy[resolveAuthLocale(headerStore.get("accept-language"))];
  const validReturnTo = returnTo && isValidReturnTo(returnTo) ? returnTo : null;
  const signInHref = validReturnTo
    ? `${API_PUBLIC}/auth/google/start?returnTo=${encodeURIComponent(validReturnTo)}`
    : `${API_PUBLIC}/auth/google/start`;
  const showDemo = WebEnv.DEMO_MODE_ENABLED === "true";

  return (
    <AuthShell cardClassName="flex flex-col items-center gap-6 py-8 sm:py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-sm">
        V
      </div>
      {demoExpired && (
        <p className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700" role="status">
          {copy.login.demoExpired}
        </p>
      )}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-balance text-3xl font-semibold text-foreground">{copy.login.title}</h1>
        <p className="max-w-xs text-pretty text-sm leading-6 text-muted-foreground">
          {copy.login.description}
        </p>
      </div>
      <SignInButton
        href={signInHref}
        className={cn(buttonVariants({ variant: "default" }), "h-11 w-full rounded-xl text-base")}
        label={copy.login.signIn}
        loadingLabel={copy.login.connecting}
        apiUnreachableMessage={copy.login.apiUnreachable}
      />
      {showDemo && (
        <>
          <div className="flex w-full items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{copy.login.separator}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <DemoButton
            className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-xl border-border bg-background text-base text-foreground shadow-none hover:bg-muted")}
            label={copy.login.demoLabel}
            loadingLabel={copy.login.demoLoadingLabel}
            rateLimitedMessage={copy.login.demoRateLimited}
            fallbackErrorMessage={copy.login.demoFailed}
            networkErrorMessage={copy.login.demoNetworkError}
          />
        </>
      )}
      <p className="text-center text-xs leading-5 text-muted-foreground">
        {copy.shared.termsPrivacyPrefix}{" "}
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
          {copy.shared.terms}
        </Link>{" "}
        /{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          {copy.shared.privacy}
        </Link>
        .
      </p>
    </AuthShell>
  );
}
