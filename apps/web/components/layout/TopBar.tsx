import { TooltipInfo } from "../ui/TooltipInfo";
import { UserAvatarButton } from "../profile/UserAvatarButton";

interface TopBarProps {
  userId?: string;
  onOpenSettings: () => void;
  productName: string;
  title: string;
  titleTooltip: string;
  openSettingsLabel: string;
  /** When true, show skeleton (title area + avatar + pill). Used on first visit only; background refresh keeps static content. */
  skeleton?: boolean;
}

export function TopBar({
  userId,
  onOpenSettings,
  productName,
  title,
  titleTooltip,
  openSettingsLabel,
  skeleton = false,
}: TopBarProps) {
  if (skeleton) {
    return (
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[rgba(8,15,30,0.94)]" aria-hidden="true" role="banner">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8 md:py-5">
          <div className="min-w-0 flex-1">
            <div className="skeleton-line h-3 w-24 rounded" />
            <div className="skeleton-line skeleton-line--delay mt-3 h-9 w-52 rounded-2xl" />
          </div>
          <div className="flex items-center gap-2">
            <div className="skeleton-line h-12 w-12 shrink-0 rounded-full" />
            <div className="skeleton-line h-11 w-24 rounded-full" />
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[rgba(8,15,30,0.94)]" role="banner">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8 md:py-5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{productName}</p>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-ink sm:text-2xl md:text-[2rem]" data-testid="topbar-title">
              {title}
            </h1>
            <TooltipInfo
              label={title}
              content={titleTooltip}
              triggerTestId="tooltip-app-title-trigger"
              contentTestId="tooltip-app-title-content"
            />
          </div>
        </div>
        <div className="shrink-0">
          <UserAvatarButton userId={userId} onOpenSettings={onOpenSettings} openSettingsLabel={openSettingsLabel} />
        </div>
      </div>
    </header>
  );
}
