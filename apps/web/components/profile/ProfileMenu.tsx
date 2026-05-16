"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { ChevronDown, LogOut, Monitor, Moon, Shield, Sun, UserCircle2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/shadcn/avatar";
import { Button } from "../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/shadcn/dropdown-menu";
import { clearContextCookie } from "../../lib/context";
import { cn } from "../../lib/utils";

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

interface ProfileMenuProps {
  userId?: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  email?: string | null;
  role?: string;
  /** Click handler for the (Phase 3c-temporary) Profile link — opens the
   * Settings drawer's profile tab in 3c, becomes `/settings/profile` in 3d. */
  onOpenProfile?: () => void;
  signOutHref: string;
  /** Optional copy overrides; defaults match the locked English wording. */
  labels?: {
    profileLink?: string;
    adminLink?: string;
    signOut?: string;
    themeLight?: string;
    themeSystem?: string;
    themeDark?: string;
  };
}

/**
 * Identity-only avatar dropdown built on shadcn `DropdownMenu` + `Avatar`.
 * Replaces `UserAvatarButton.tsx`. Per spec amendment #11: header (name +
 * email) + Profile link + Theme switcher + Sign out + role-gated Admin link.
 * NO Settings link — configuration is sidebar-only.
 *
 * Picture URL validation (Preserves §8 item 16, per
 * `.claude/rules/provider-url-sanitization.md`): HTTPS-only, `referrerPolicy
 * ="no-referrer"`, onError fallback to initials.
 *
 * The Admin entry carries both `data-testid="profile-menu-admin-link"` and
 * the legacy `data-testid="avatar-menu-admin"` so existing OAuth specs keep
 * passing without an immediate rewrite (Preserves §8 item 12).
 */
export function ProfileMenu({
  userId,
  displayName,
  pictureUrl,
  email,
  role,
  onOpenProfile,
  signOutHref,
  labels,
}: ProfileMenuProps) {
  const avatar = deriveAvatar(displayName ?? userId);
  const [imgError, setImgError] = useState(false);
  const { theme, setTheme } = useTheme();
  // Preserves §8 item 16 — accept only https URLs from the OAuth provider
  // before piping into `<img>`. Reject `data:`, `javascript:`, and `http:`.
  const safePictureUrl =
    pictureUrl && pictureUrl.startsWith("https://") && !imgError ? pictureUrl : null;

  const profileLinkLabel = labels?.profileLink ?? "Profile";
  const adminLinkLabel = labels?.adminLink ?? "Admin";
  const signOutLabel = labels?.signOut ?? "Sign out";
  const themeLight = labels?.themeLight ?? "Light";
  const themeSystem = labels?.themeSystem ?? "System";
  const themeDark = labels?.themeDark ?? "Dark";

  return (
    // modal={false} keeps the rest of the page interactive while the menu is
    // open — necessary because the `avatar-menu-admin` / `app-sidebar-nav-*`
    // back-compat helpers in the OAuth specs open the dropdown then click
    // targets OUTSIDE it (e.g. the sidebar Sharing entry post-amendment #11).
    // Without this, Radix injects pointer-events:none on <html> which blocks
    // those outside clicks until the menu is dismissed by a focus shift.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-10 items-center gap-1 rounded-full border border-border bg-card p-0 pr-1 shadow-sm hover:bg-card/90"
          aria-label="User menu"
          data-testid="topbar-profile-menu-trigger"
        >
          <Avatar className="h-9 w-9">
            {safePictureUrl ? (
              <AvatarImage
                src={safePictureUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
              />
            ) : null}
            <AvatarFallback
              className="text-xs font-semibold text-white"
              style={{ backgroundColor: avatar.color }}
            >
              {/* `aria-hidden=true` so the textual initials don't get
                  announced (the trigger already has `aria-label="User menu"`).
                  Also serves as the page-object's `avatarInitials` locator
                  anchor — see libs/test-e2e/src/pages/layout/AppShellPage.ts. */}
              <span aria-hidden="true">
                {avatar.initials || <UserCircle2 className="h-4 w-4" />}
              </span>
            </AvatarFallback>
          </Avatar>
          {/* Phase 3 §12 A4 — chevron-on-trigger affordance. No new testid;
              the existing `topbar-profile-menu-trigger` still resolves to the
              outer <Button>. `aria-hidden` so screen readers ignore it
              (`aria-label="User menu"` on the Button already announces intent). */}
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64"
        data-testid="profile-menu-content"
      >
        {(displayName || email) && (
          <>
            <DropdownMenuLabel
              className="flex flex-col gap-0.5 py-2"
              data-testid="profile-menu-header"
            >
              {displayName ? (
                <span className="truncate text-sm font-semibold text-foreground">
                  {displayName}
                </span>
              ) : null}
              {email ? (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {email}
                </span>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        {onOpenProfile ? (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onOpenProfile();
            }}
            data-testid="profile-menu-profile-link"
          >
            <UserCircle2 className="mr-2 h-4 w-4 text-muted-foreground" />
            {profileLinkLabel}
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setTheme("light");
          }}
          data-testid="profile-menu-theme-light"
          className={cn(theme === "light" && "bg-accent")}
        >
          <Sun className="mr-2 h-4 w-4 text-muted-foreground" />
          {themeLight}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setTheme("system");
          }}
          data-testid="profile-menu-theme-system"
          className={cn(theme === "system" && "bg-accent")}
        >
          <Monitor className="mr-2 h-4 w-4 text-muted-foreground" />
          {themeSystem}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setTheme("dark");
          }}
          data-testid="profile-menu-theme-dark"
          className={cn(theme === "dark" && "bg-accent")}
        >
          <Moon className="mr-2 h-4 w-4 text-muted-foreground" />
          {themeDark}
        </DropdownMenuItem>

        {role === "admin" ? (
          <>
            <DropdownMenuSeparator />
            {/* Preserves §8 item 12 — the wrapper div carries the legacy
                `avatar-menu-admin` testid so existing OAuth specs that
                `getByTestId("avatar-menu-admin").click()` still hit a
                clickable element (the descendant <a>). The new canonical
                locator is `profile-menu-admin-link` on the <a> itself. */}
            <div data-testid="avatar-menu-admin">
              <DropdownMenuItem asChild>
                <a href="/admin" data-testid="profile-menu-admin-link">
                  <Shield className="mr-2 h-4 w-4 text-muted-foreground" />
                  {adminLinkLabel}
                </a>
              </DropdownMenuItem>
            </div>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a
            href={signOutHref}
            onClick={() => clearContextCookie()}
            data-testid="profile-menu-sign-out"
          >
            <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
            {signOutLabel}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
