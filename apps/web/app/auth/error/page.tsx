import Link from "next/link";
import { headers } from "next/headers";
import { buttonVariants } from "../../../components/ui/Button";
import { AuthShell } from "../../../components/layout/AuthShell";
import { authPageCopy, resolveAuthLocale, type AuthErrorReason } from "../../../lib/authPages";
import { cn } from "../../../lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  searchParams: Promise<{ reason?: string }>;
}

export default async function AuthErrorPage({ searchParams }: Props) {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  const copy = authPageCopy[locale];
  const { reason } = await searchParams;
  const typedReason = reason as AuthErrorReason | undefined;
  const message = (typedReason ? copy.errorReasons[typedReason] : undefined) ?? copy.defaultError;

  return (
    <AuthShell cardClassName="flex flex-col items-center gap-6 py-8 sm:py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
        <AlertTriangle className="h-7 w-7" />
      </div>
      {typedReason ? (
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          ERR · {typedReason}
        </span>
      ) : null}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-balance text-3xl font-semibold text-foreground">{message.title}</h1>
        <p className="max-w-sm text-pretty text-sm leading-6 text-muted-foreground">{message.description}</p>
      </div>
      <Link
        href="/login"
        data-testid="auth-error-try-again"
        className={cn(buttonVariants({ variant: "default" }), "h-11 w-full rounded-xl text-base")}
      >
        <RotateCcw className="h-4 w-4" />
        {message.linkText ?? copy.defaultError.linkText}
      </Link>
      <Link
        href="/"
        className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-xl border-border bg-background text-base text-foreground shadow-none hover:bg-muted")}
      >
        {copy.shared.backHome}
      </Link>
    </AuthShell>
  );
}
