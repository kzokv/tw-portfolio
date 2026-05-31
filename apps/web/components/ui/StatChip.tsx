interface StatChipProps {
  label: string;
  value: string;
  detail?: string;
  testId?: string;
}

export function StatChip({ label, value, detail, testId }: StatChipProps) {
  return (
    <div
      className="rounded-[22px] border border-slate-200 bg-white/88 px-4 py-3 shadow-[0_12px_24px_rgba(148,163,184,0.08)]"
      data-testid={testId}
    >
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1.5 truncate text-lg font-semibold text-slate-950">{value}</p>
      {detail ? <p className="mt-1 truncate text-sm text-slate-500">{detail}</p> : null}
    </div>
  );
}
