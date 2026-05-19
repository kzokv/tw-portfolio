import Link from "next/link";
import { headers } from "next/headers";
import { buttonVariants } from "../../../components/ui/Button";
import { AuthShell } from "../../../components/layout/AuthShell";
import { authPageCopy, resolveAuthLocale, type AuthErrorReason } from "../../../lib/authPages";
import { cn } from "../../../lib/utils";

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
    <AuthShell cardClassName="flex flex-col items-center gap-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{message.title}</h1>
        <p className="text-sm text-muted-foreground">{message.description}</p>
      </div>
      <Link
        href="/login"
        data-testid="auth-error-try-again"
        className={cn(buttonVariants({ variant: "default" }), "w-full")}
      >
        {message.linkText ?? copy.defaultError.linkText}
      </Link>
    </AuthShell>
  );
}
