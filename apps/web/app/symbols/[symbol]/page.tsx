import { redirect } from "next/navigation";

interface LegacySymbolRedirectProps {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ accountId?: string }>;
}

export default async function LegacySymbolRedirect({ params, searchParams }: LegacySymbolRedirectProps) {
  const [{ symbol }, query] = await Promise.all([params, searchParams]);
  const qs = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) => (value ? [[key, value]] : [])),
  ).toString();
  redirect(`/tickers/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ""}`);
}
