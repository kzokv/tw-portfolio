import { UserCircle2 } from "lucide-react";
import { Button } from "../ui/Button";

const AVATAR_COLORS = [
  "#4F46E5",
  "#4338CA",
  "#2563EB",
  "#0F766E",
  "#334155",
  "#6D5EFC",
  "#1D4ED8",
  "#312E81",
];

function deriveAvatar(userId: string | undefined) {
  if (!userId) {
    return { initials: "U", color: AVATAR_COLORS[0] };
  }

  const cleaned = userId.replace(/[^a-zA-Z0-9\s_-]/g, "").trim();
  const segments = cleaned.split(/[\s_-]+/).filter(Boolean);

  let initials = "U";
  if (segments.length >= 2) {
    initials = `${segments[0][0]}${segments[1][0]}`.toUpperCase();
  } else if (segments.length === 1) {
    initials = segments[0].slice(0, 2).toUpperCase();
  }

  const hash = cleaned.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];

  return { initials, color };
}

interface UserAvatarButtonProps {
  userId?: string;
  onOpenSettings: () => void;
  openSettingsLabel: string;
}

export function UserAvatarButton({ userId, onOpenSettings, openSettingsLabel }: UserAvatarButtonProps) {
  const avatar = deriveAvatar(userId);

  return (
    <Button
      variant="ghost"
      className="h-12 w-12 rounded-full border border-white/10 bg-white/5 p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/10"
      onClick={onOpenSettings}
      aria-label={openSettingsLabel}
      data-testid="avatar-button"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
        style={{ backgroundColor: avatar.color }}
        aria-hidden="true"
      >
        {avatar.initials || <UserCircle2 className="h-4 w-4" />}
      </span>
    </Button>
  );
}
