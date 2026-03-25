interface StatusToastProps {
  message?: string;
  variant: "success" | "error";
  testId?: string;
}

const styles = {
  success:
    "rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700",
  error:
    "rounded-[22px] border border-[rgba(251,113,133,0.28)] bg-[rgba(254,226,226,0.9)] px-4 py-3 text-sm text-rose-700",
};

export function StatusToast({ message, variant, testId }: StatusToastProps) {
  if (!message) return null;
  return (
    <p data-testid={testId} role="status" aria-live="polite" className={`mt-4 ${styles[variant]}`}>
      {message}
    </p>
  );
}
