import { headers } from "next/headers";
import { resolveAuthLocale } from "../../../lib/authPages";
import { getDictionary } from "../../../lib/i18n";
import { AuthShell } from "../../../components/layout/AuthShell";
import Link from "next/link";
import { buttonVariants } from "../../../components/ui/Button";
import { cn } from "../../../lib/utils";

export default async function PublicShareNotFound() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  const copy = getDictionary(locale).sharing.publicLinks.publicView;

  return (
    <AuthShell cardClassName="flex w-full max-w-lg flex-col items-center gap-5 py-8 text-center sm:py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-sm">
        V
      </div>
      <div
        className="flex w-full flex-col gap-4"
        data-testid="public-share-not-found"
      >
        <h1 className="text-balance text-3xl font-semibold text-foreground" data-testid="public-share-not-found-heading">
          {copy.notFoundTitle}
        </h1>
        <p className="text-pretty text-sm leading-6 text-muted-foreground">{copy.notFoundDescription}</p>
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "default" }), "h-11 w-full rounded-xl text-base")}
        >
          {copy.signUpCta}
        </Link>
        <p className="text-xs leading-5 text-muted-foreground">{copy.footerDisclosure}</p>
      </div>
    </AuthShell>
  );
}
