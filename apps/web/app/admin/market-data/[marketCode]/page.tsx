import { notFound, redirect } from "next/navigation";

interface AdminMarketDataMarketPageProps {
  params: Promise<{ marketCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const marketCodes = new Set(["TW", "US", "AU", "KR", "JP", "FX"]);

export default async function AdminMarketDataMarketPage({
  params,
  searchParams,
}: AdminMarketDataMarketPageProps) {
  const { marketCode: rawMarketCode } = await params;
  const marketCode = rawMarketCode.toUpperCase();
  if (!marketCodes.has(marketCode)) notFound();

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (typeof value === "string") {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  redirect(`/admin/market-data/${marketCode}/overview${queryString ? `?${queryString}` : ""}`);
}
