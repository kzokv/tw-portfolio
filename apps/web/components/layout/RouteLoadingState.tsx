import { Skeleton } from "../ui/shadcn/skeleton";

interface RouteLoadingStateProps {
  eyebrow: string;
  title: string;
  body: string;
}

export function RouteLoadingState({ eyebrow, title, body }: RouteLoadingStateProps) {
  return (
    <section
      className="space-y-6"
      data-testid="route-loading-state"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="space-y-3 rounded-[28px] border border-border bg-card/80 p-6 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
          {eyebrow}
        </p>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{body}</p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-foreground/35" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-4 rounded-[28px] border border-border bg-card/70 p-5 shadow-sm">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-5/6 rounded-xl" />
          <Skeleton className="h-[18rem] w-full rounded-2xl" />
        </div>
        <div className="space-y-4 rounded-[28px] border border-border bg-card/70 p-5 shadow-sm">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      </div>
    </section>
  );
}
