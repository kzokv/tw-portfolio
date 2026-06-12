"use client";

import { getDictionary } from "../../../lib/i18n";
import { resolveClientLocale } from "../../../lib/i18n/clientLocale";

export default function TickerError({ reset }: { error: Error; reset: () => void }) {
  const copy = getDictionary(resolveClientLocale()).appError;

  return (
    <div>
      <h2>{copy.title}</h2>
      <button onClick={reset}>{copy.retry}</button>
    </div>
  );
}
