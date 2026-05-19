import { headers } from "next/headers";
import { Card } from "../../../components/ui/Card";
import { resolveAuthLocale } from "../../../lib/authPages";
import { getDictionary } from "../../../lib/i18n";

export default async function PublicShareNotFound() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  const copy = getDictionary(locale).sharing.publicLinks.publicView;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card
        className="flex w-full max-w-lg flex-col gap-4 py-10 text-center"
        data-testid="public-share-not-found"
      >
        <h1 className="text-2xl font-semibold text-slate-950" data-testid="public-share-not-found-heading">
          {copy.notFoundTitle}
        </h1>
        <p className="text-sm leading-6 text-slate-600">{copy.notFoundDescription}</p>
      </Card>
    </main>
  );
}
