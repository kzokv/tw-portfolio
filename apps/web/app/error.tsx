"use client";

import { getDictionary } from "../lib/i18n";
import { resolveClientLocale } from "../lib/i18n/clientLocale";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const locale = resolveClientLocale();
  const copy = getDictionary(locale).appError;

  return (
    <html lang={locale}>
      <body>
        <div>
          <h2>{copy.title}</h2>
          <button onClick={reset}>{copy.retry}</button>
        </div>
      </body>
    </html>
  );
}
