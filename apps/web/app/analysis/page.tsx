import Link from "next/link";
import { AppShell } from "../../components/layout/AppShell";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { getDictionary } from "../../lib/i18n";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { UserSettings } from "@vakwen/shared-types";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/shadcn/card";
import { Button } from "../../components/ui/Button";

export default async function AnalysisIndexPage() {
  const [session, profile, sidebarOpen, settings] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
  ]);
  const locale = settings?.locale ?? "en";
  const dict = getDictionary(locale);

  return (
    <AppShell
      section="analysis"
      isDemo={session.isDemo}
      localeOverride={locale}
      initialProfile={profile}
      initialSettings={settings}
      initialSidebarOpen={sidebarOpen}
      portfolioConfigMode="lazy"
    >
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-primary/75">{dict.analysis.indexEyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">{dict.analysis.indexTitle}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{dict.analysis.indexDescription}</p>
        </div>
        <div className="mt-6 grid gap-4 md:max-w-xl">
          <Card className="border-border/80">
            <CardHeader>
              <CardTitle>{dict.analysis.indexCardTitle}</CardTitle>
              <CardDescription>{dict.analysis.indexCardBody}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/analysis/unrealized-pnl">{dict.analysis.indexCardCta}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}
