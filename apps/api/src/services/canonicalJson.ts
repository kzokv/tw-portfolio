function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

/** Canonical JSON for semantic comparisons across JSONB round trips. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
