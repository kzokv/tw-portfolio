"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CurrencyExpectedReceived } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import {
  bucketByGranularity,
  bucketedToChartData,
  computeCumulative,
  extractCurrencies,
  formatYAxis,
  type Granularity,
} from "./dividendReviewUtils";

interface DividendReviewChartsProps {
  byMonth: Record<string, CurrencyExpectedReceived>;
  byTicker: Record<string, CurrencyExpectedReceived>;
  dict: AppDictionary;
  defaultGranularity?: Granularity;
}

type ChartTab = "monthly" | "accumulated" | "byTicker";

const EXPECTED_COLOR = "#0ea5e9"; // sky-500
const RECEIVED_COLOR = "#22c55e"; // green-500

function CurrencySelector({
  currencies,
  selected,
  onChange,
}: {
  currencies: string[];
  selected: string;
  onChange: (c: string) => void;
}) {
  if (currencies.length <= 1) return null;
  return (
    <select
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      data-testid="chart-currency-selector"
    >
      {currencies.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}

function GranularityToggle({
  value,
  onChange,
  dict,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
  dict: AppDictionary;
}) {
  const options: { key: Granularity; label: string }[] = [
    { key: "month", label: dict.dividends.review.chart.granularityMonth },
    { key: "quarter", label: dict.dividends.review.chart.granularityQuarter },
    { key: "year", label: dict.dividends.review.chart.granularityYear },
  ];

  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white" data-testid="chart-granularity-toggle">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            value === opt.key
              ? "bg-sky-100 text-sky-700"
              : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/90 text-sm text-slate-500">
      {message}
    </div>
  );
}

function MonthlyBarChart({
  byMonth,
  dict,
  defaultGranularity,
}: {
  byMonth: Record<string, CurrencyExpectedReceived>;
  dict: AppDictionary;
  defaultGranularity?: Granularity;
}) {
  const currencies = useMemo(() => extractCurrencies(byMonth), [byMonth]);
  const [currency, setCurrency] = useState(() => currencies[0] ?? "TWD");
  const [granularity, setGranularity] = useState<Granularity>(defaultGranularity ?? "month");
  // Reset selected currency when the dataset changes and the current selection is no longer available.
  useEffect(() => {
    if (currencies.length > 0 && !currencies.includes(currency)) {
      setCurrency(currencies[0]);
    }
  }, [currencies]);
  useEffect(() => {
    if (defaultGranularity != null) {
      setGranularity(defaultGranularity);
    }
  }, [defaultGranularity]);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const data = useMemo(() => {
    const bucketed = bucketByGranularity(byMonth, granularity);
    return bucketedToChartData(bucketed, currency);
  }, [byMonth, granularity, currency]);

  const handleLegendClick = (entry: { value?: string }) => {
    if (!entry.value) return;
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(entry.value!)) {
        next.delete(entry.value!);
      } else {
        next.add(entry.value!);
      }
      return next;
    });
  };

  if (data.length === 0) {
    return <EmptyState message={dict.dividends.review.chart.noData} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GranularityToggle value={granularity} onChange={setGranularity} dict={dict} />
        <CurrencySelector currencies={currencies} selected={currency} onChange={setCurrency} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} data-testid="monthly-bar-chart">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => Number(value).toLocaleString()} />
          <Legend onClick={handleLegendClick} wrapperStyle={{ cursor: "pointer" }} />
          <Bar
            dataKey="expected"
            name={dict.dividends.review.chart.expected}
            fill={EXPECTED_COLOR}
            hide={hiddenSeries.has(dict.dividends.review.chart.expected)}
          />
          <Bar
            dataKey="received"
            name={dict.dividends.review.chart.received}
            fill={RECEIVED_COLOR}
            hide={hiddenSeries.has(dict.dividends.review.chart.received)}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AccumulatedAreaChart({
  byMonth,
  dict,
  defaultGranularity,
}: {
  byMonth: Record<string, CurrencyExpectedReceived>;
  dict: AppDictionary;
  defaultGranularity?: Granularity;
}) {
  const currencies = useMemo(() => extractCurrencies(byMonth), [byMonth]);
  const [currency, setCurrency] = useState(() => currencies[0] ?? "TWD");
  const [granularity, setGranularity] = useState<Granularity>(defaultGranularity ?? "month");
  // Reset selected currency when the dataset changes and the current selection is no longer available.
  useEffect(() => {
    if (currencies.length > 0 && !currencies.includes(currency)) {
      setCurrency(currencies[0]);
    }
  }, [currencies]);
  useEffect(() => {
    if (defaultGranularity != null) {
      setGranularity(defaultGranularity);
    }
  }, [defaultGranularity]);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const data = useMemo(() => {
    const bucketed = bucketByGranularity(byMonth, granularity);
    return computeCumulative(bucketed, currency);
  }, [byMonth, granularity, currency]);

  const handleLegendClick = (entry: { value?: string }) => {
    if (!entry.value) return;
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(entry.value!)) {
        next.delete(entry.value!);
      } else {
        next.add(entry.value!);
      }
      return next;
    });
  };

  if (data.length === 0) {
    return <EmptyState message={dict.dividends.review.chart.noData} />;
  }

  if (data.length < 2) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <GranularityToggle value={granularity} onChange={setGranularity} dict={dict} />
          <CurrencySelector currencies={currencies} selected={currency} onChange={setCurrency} />
        </div>
        <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/90 text-sm text-slate-500">
          {dict.dividends.review.chart.rangeTooNarrow}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GranularityToggle value={granularity} onChange={setGranularity} dict={dict} />
        <CurrencySelector currencies={currencies} selected={currency} onChange={setCurrency} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} data-testid="accumulated-area-chart">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => Number(value).toLocaleString()} />
          <Legend onClick={handleLegendClick} wrapperStyle={{ cursor: "pointer" }} />
          <Area
            type="monotone"
            dataKey="expected"
            name={dict.dividends.review.chart.expected}
            stroke={EXPECTED_COLOR}
            fill={EXPECTED_COLOR}
            fillOpacity={0.2}
            hide={hiddenSeries.has(dict.dividends.review.chart.expected)}
          />
          <Area
            type="monotone"
            dataKey="received"
            name={dict.dividends.review.chart.received}
            stroke={RECEIVED_COLOR}
            fill={RECEIVED_COLOR}
            fillOpacity={0.2}
            hide={hiddenSeries.has(dict.dividends.review.chart.received)}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ByTickerBarChart({
  byTicker,
  dict,
}: {
  byTicker: Record<string, CurrencyExpectedReceived>;
  dict: AppDictionary;
}) {
  const currencies = useMemo(() => extractCurrencies(byTicker), [byTicker]);
  const [currency, setCurrency] = useState(() => currencies[0] ?? "TWD");
  // Reset selected currency when the dataset changes and the current selection is no longer available.
  useEffect(() => {
    if (currencies.length > 0 && !currencies.includes(currency)) {
      setCurrency(currencies[0]);
    }
  }, [currencies]);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const data = useMemo(() => {
    return Object.entries(byTicker)
      .map(([ticker, amounts]) => ({
        label: ticker,
        expected: amounts[currency]?.expected ?? 0,
        received: amounts[currency]?.received ?? 0,
      }))
      .sort((a, b) => b.received - a.received);
  }, [byTicker, currency]);

  const handleLegendClick = (entry: { value?: string }) => {
    if (!entry.value) return;
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(entry.value!)) {
        next.delete(entry.value!);
      } else {
        next.add(entry.value!);
      }
      return next;
    });
  };

  if (data.length === 0) {
    return <EmptyState message={dict.dividends.review.chart.noData} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CurrencySelector currencies={currencies} selected={currency} onChange={setCurrency} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} data-testid="by-ticker-bar-chart">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => Number(value).toLocaleString()} />
          <Legend onClick={handleLegendClick} wrapperStyle={{ cursor: "pointer" }} />
          <Bar
            dataKey="expected"
            name={dict.dividends.review.chart.expected}
            fill={EXPECTED_COLOR}
            hide={hiddenSeries.has(dict.dividends.review.chart.expected)}
          />
          <Bar
            dataKey="received"
            name={dict.dividends.review.chart.received}
            fill={RECEIVED_COLOR}
            hide={hiddenSeries.has(dict.dividends.review.chart.received)}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DividendReviewCharts({
  byMonth,
  byTicker,
  dict,
  defaultGranularity,
}: DividendReviewChartsProps) {
  const [activeTab, setActiveTab] = useState<ChartTab>("monthly");

  const tabs: { key: ChartTab; label: string }[] = [
    { key: "monthly", label: dict.dividends.review.chart.tabMonthly },
    { key: "accumulated", label: dict.dividends.review.chart.tabAccumulated },
    { key: "byTicker", label: dict.dividends.review.chart.tabByTicker },
  ];

  return (
    <div className="space-y-4" data-testid="dividend-review-charts">
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50/90 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            onClick={() => setActiveTab(tab.key)}
            data-testid={`chart-tab-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "monthly" && (
        <MonthlyBarChart byMonth={byMonth} dict={dict} defaultGranularity={defaultGranularity} />
      )}
      {activeTab === "accumulated" && (
        <AccumulatedAreaChart byMonth={byMonth} dict={dict} defaultGranularity={defaultGranularity} />
      )}
      {activeTab === "byTicker" && (
        <ByTickerBarChart byTicker={byTicker} dict={dict} />
      )}
    </div>
  );
}
