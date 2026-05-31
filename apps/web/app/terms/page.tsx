import { headers } from "next/headers";
import Link from "next/link";
import { AuthShell } from "../../components/layout/AuthShell";
import { buttonVariants } from "../../components/ui/Button";
import { authPageCopy, resolveAuthLocale } from "../../lib/authPages";
import { legalPageCopy } from "../../lib/legalPages";
import { cn } from "../../lib/utils";

export default async function TermsPage() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  const copy = legalPageCopy[locale].terms;

  return (
    <AuthShell cardClassName="max-w-3xl space-y-8 py-8 sm:py-10">
      <div className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-primary/80">{copy.eyebrow}</p>
        <div className="space-y-2">
          <h1 className="text-balance text-3xl font-semibold text-foreground">{copy.title}</h1>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">{copy.description}</p>
        </div>
        <p className="text-xs text-muted-foreground">{copy.updatedLabel}</p>
      </div>

      <div className="space-y-5">
        {copy.sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{section.body}</p>
          </section>
        ))}
      </div>

      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl border-border bg-background shadow-none hover:bg-muted")}
      >
        {copy.backToLogin}
      </Link>
      <Link href="/privacy" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
        {authPageCopy[locale].shared.privacy}
      </Link>
    </AuthShell>
  );
}
