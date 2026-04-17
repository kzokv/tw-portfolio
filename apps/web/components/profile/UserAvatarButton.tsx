"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Settings, LogOut, Shield, UserCircle2 } from "lucide-react";
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

function deriveAvatar(source: string | undefined) {
  if (!source) {
    return { initials: "U", color: AVATAR_COLORS[0] };
  }

  const cleaned = source.replace(/[^a-zA-Z0-9\s_-]/g, "").trim();
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
  displayName?: string | null;
  pictureUrl?: string | null;
  email?: string | null;
  role?: string;
  onOpenSettings: () => void;
  openSettingsLabel: string;
  signOutLabel: string;
  signOutHref: string;
}

export function UserAvatarButton({
  userId,
  displayName,
  pictureUrl,
  email,
  role,
  onOpenSettings,
  openSettingsLabel,
  signOutLabel,
  signOutHref,
}: UserAvatarButtonProps) {
  const avatar = deriveAvatar(displayName ?? userId);
  const [imgError, setImgError] = useState(false);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          className="h-11 w-11 rounded-full border border-slate-200 bg-white/88 p-0 shadow-[0_12px_28px_rgba(148,163,184,0.12)] hover:bg-white"
          aria-label="User menu"
          data-testid="avatar-button"
        >
          {pictureUrl && !imgError ? (
            <img
              src={pictureUrl}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
              aria-hidden="true"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
            />
          ) : (
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
              style={{ backgroundColor: avatar.color }}
              aria-hidden="true"
            >
              {avatar.initials || <UserCircle2 className="h-4 w-4" />}
            </span>
          )}
        </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[200px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
          data-testid="avatar-dropdown-menu"
        >
          {(displayName || email) && (
            <>
              <div className="px-3 py-2.5" data-testid="avatar-menu-identity">
                {displayName && (
                  <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
                )}
                {email && (
                  <p className="truncate text-xs text-slate-500">{email}</p>
                )}
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-slate-200" />
            </>
          )}

          <DropdownMenu.Item
            onSelect={onOpenSettings}
            className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none transition hover:bg-slate-100 focus:bg-slate-100 data-[highlighted]:bg-slate-100"
            data-testid="avatar-menu-settings"
          >
            <Settings className="h-4 w-4 text-slate-400" />
            {openSettingsLabel}
          </DropdownMenu.Item>

          {role === "admin" && (
            <DropdownMenu.Item asChild>
              <a
                href="/admin"
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none transition hover:bg-slate-100 focus:bg-slate-100 data-[highlighted]:bg-slate-100"
                data-testid="avatar-menu-admin"
              >
                <Shield className="h-4 w-4 text-slate-400" />
                Admin
              </a>
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-slate-200" />

          <DropdownMenu.Item asChild>
            <a
              href={signOutHref}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none transition hover:bg-slate-100 focus:bg-slate-100 data-[highlighted]:bg-slate-100"
              data-testid="avatar-menu-sign-out"
            >
              <LogOut className="h-4 w-4 text-slate-400" />
              {signOutLabel}
            </a>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
