import type { ProfileDto } from "@vakwen/shared-types";
import Link from "next/link";
import { headers } from "next/headers";
import { buttonVariants } from "../../../components/ui/Button";
import { AuthShell } from "../../../components/layout/AuthShell";
import { SignInButton } from "../../../components/SignInButton";
import { getSession } from "../../../lib/auth";
import { authPageCopy, resolveAuthLocale, type InviteStatus } from "../../../lib/authPages";
import { getJson, API_BASE, API_PUBLIC, ApiError } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { ArrowRight, LogOut, UserRoundPlus } from "lucide-react";

interface InviteStatusResponse {
  status: InviteStatus;
}

interface InvitePageProps {
  params: Promise<{ code: string }>;
}

async function fetchInviteStatus(code: string): Promise<InviteStatus | null> {
  try {
    const response = await fetch(`${API_BASE}/invites/${encodeURIComponent(code)}/status`, {
      cache: "no-store",
    });

    if (!response.ok) return null;

    const payload = await response.json() as InviteStatusResponse;
    return payload.status;
  } catch {
    return null;
  }
}

async function fetchCurrentProfile(): Promise<ProfileDto | null> {
  try {
    return await getJson<ProfileDto>("/profile");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    return null;
  }
}

export default async function InvitePage({ params }: InvitePageProps) {
  const [{ code: rawCode }, session, headerStore] = await Promise.all([
    params,
    getSession(),
    headers(),
  ]);

  const inviteCode = rawCode.trim().toUpperCase();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  const copy = authPageCopy[locale].invite;

  if (session) {
    const profile = await fetchCurrentProfile();
    const email = profile?.email ?? copy.signedInIdentityFallback;

    return (
      <AuthShell cardClassName="flex max-w-lg flex-col gap-6 py-8 sm:py-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-sm">
          V
        </div>
        <div className="space-y-2 text-center" data-testid="invite-card">
          <h1 className="text-balance text-3xl font-semibold text-foreground">{copy.signedInTitle}</h1>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">
            {copy.signedInDescription.replace("{email}", email)}
          </p>
        </div>
	        <div className="w-full rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
	          <p className="font-medium text-foreground">{email}</p>
	          <p className="mt-1 font-mono text-xs uppercase tracking-[0.12em]">{copy.codeLabel} {inviteCode}</p>
	        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href={`${API_PUBLIC}/auth/logout?returnTo=${encodeURIComponent(`/invite/${inviteCode}`)}`}
            data-testid="invite-sign-out-button"
            className={cn(buttonVariants({ variant: "default" }), "h-11 w-full rounded-xl text-base")}
          >
            <LogOut className="h-4 w-4" />
            {copy.signOut}
          </a>
          <Link
            href="/dashboard"
            data-testid="invite-dashboard-button"
            className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-xl border-border bg-background text-base text-foreground shadow-none hover:bg-muted")}
          >
            <ArrowRight className="h-4 w-4" />
            {copy.dashboard}
          </Link>
        </div>
      </AuthShell>
    );
  }

  const inviteStatus = inviteCode ? await fetchInviteStatus(inviteCode) : "invalid";
  const statusMessage = inviteStatus === "valid"
    ? copy.valid
    : inviteStatus
      ? copy.statuses[inviteStatus]
      : copy.unavailable;
  const signInHref = `${API_PUBLIC}/auth/google/start?invite_code=${encodeURIComponent(inviteCode)}`;

  return (
    <AuthShell cardClassName="flex max-w-lg flex-col gap-6 py-8 sm:py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-sm">
        V
      </div>
	      <div className="space-y-2 text-center" data-testid="invite-card">
	        <h1 className="text-balance text-3xl font-semibold text-foreground">{statusMessage.title}</h1>
	        <p className="text-pretty text-sm leading-6 text-muted-foreground" data-testid="invite-status-message">
	          {statusMessage.description}
	        </p>
	      </div>
	      <div className="w-full rounded-2xl border border-border bg-muted/40 px-4 py-3">
	        <div className="flex items-start justify-between gap-3">
	          <div className="min-w-0">
	            <p className="text-sm font-medium text-foreground">{copy.codeLabel}</p>
	            <p className="mt-1 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{inviteCode}</p>
	          </div>
	          <span className={cn(
	            "rounded-full px-3 py-1 text-xs font-medium",
	            inviteStatus === "valid"
	              ? "bg-primary/10 text-primary"
	              : "bg-muted text-muted-foreground",
	          )} aria-label={copy.statusLabel}>
	            {inviteStatus}
	          </span>
        </div>
      </div>
      {inviteStatus === "valid" ? (
        <>
          <SignInButton
            href={signInHref}
            className={cn(buttonVariants({ variant: "default" }), "h-11 w-full rounded-xl text-base")}
            label={copy.signIn}
            loadingLabel={copy.connecting}
            apiUnreachableMessage={copy.apiUnreachable}
          />
          <p className="text-center text-xs leading-5 text-muted-foreground">
            {authPageCopy[locale].shared.termsPrivacyPrefix}{" "}
	            <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
	              {authPageCopy[locale].shared.terms}
	            </Link>{" "}
	            /{" "}
	            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
	              {authPageCopy[locale].shared.privacy}
            </Link>
            .
          </p>
        </>
      ) : (
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-xl border-border bg-background text-base text-foreground shadow-none hover:bg-muted")}
        >
          <UserRoundPlus className="h-4 w-4" />
          {copy.signIn}
        </Link>
      )}
    </AuthShell>
  );
}
