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
      <AuthShell cardClassName="flex max-w-lg flex-col gap-6 py-10">
        <div className="space-y-2 text-center" data-testid="invite-card">
          <h1 className="font-display text-2xl font-semibold text-foreground">{copy.signedInTitle}</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {copy.signedInDescription.replace("{email}", email)}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href={`${API_PUBLIC}/auth/logout?returnTo=${encodeURIComponent(`/invite/${inviteCode}`)}`}
            data-testid="invite-sign-out-button"
            className={cn(buttonVariants({ variant: "default" }), "w-full")}
          >
            {copy.signOut}
          </a>
          <Link
            href="/dashboard"
            data-testid="invite-dashboard-button"
            className={cn(buttonVariants({ variant: "secondary" }), "w-full")}
          >
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
    <AuthShell cardClassName="flex max-w-lg flex-col gap-6 py-10">
      <div className="space-y-2 text-center" data-testid="invite-card">
        <h1 className="font-display text-2xl font-semibold text-foreground">{statusMessage.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground" data-testid="invite-status-message">
          {statusMessage.description}
        </p>
      </div>
      {inviteStatus === "valid" ? (
        <SignInButton
          href={signInHref}
          className={cn(buttonVariants({ variant: "default" }), "w-full")}
          label={copy.signIn}
          loadingLabel={copy.connecting}
          apiUnreachableMessage={copy.apiUnreachable}
        />
      ) : null}
    </AuthShell>
  );
}
