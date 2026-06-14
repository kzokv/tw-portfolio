import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";

const mockPatchSettings = vi.fn();

vi.mock("../../../features/settings/services/settingsService", () => ({
  patchSettings: (...args: unknown[]) => mockPatchSettings(...args),
}));

vi.mock("../../../components/ui/TooltipInfo", () => ({
  TooltipInfo: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

function collectItems(children: ReactNode): Array<{ value: string; label: string }> {
  const items: Array<{ value: string; label: string }> = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ children?: ReactNode; value?: string }>;
    if (typeof element.props.value === "string") {
      items.push({
        value: element.props.value,
        label: String(element.props.children ?? element.props.value),
      });
      return;
    }
    items.push(...collectItems(element.props.children));
  });
  return items;
}

vi.mock("../../../components/ui/shadcn/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {collectItems(children).map((item) => (
        <option key={item.value} value={item.value}>{item.label}</option>
      ))}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

import { GeneralSettingsClient } from "../../../components/settings/GeneralSettingsClient";
import {
  SettingsRouteProvider,
  useSettingsRouteContext,
} from "../../../components/settings/SettingsRouteProvider";
import { LOCALE_OVERRIDE_COOKIE } from "../../../lib/i18n/localeOverrideCookie";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildSettings(locale: LocaleCode = "zh-TW"): UserSettings {
  return {
    userId: "user-1",
    displayName: null,
    locale,
    costBasisMethod: "WEIGHTED_AVERAGE",
    quotePollIntervalSeconds: 10,
  };
}

function LocaleProbe() {
  const { locale } = useSettingsRouteContext();
  return <output data-testid="route-locale">{locale}</output>;
}

describe("GeneralSettingsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPatchSettings.mockReset();
    mockPatchSettings.mockResolvedValue(buildSettings("en"));
    document.cookie = `${LOCALE_OVERRIDE_COOKIE}=; Path=/; Max-Age=0`;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.cookie = `${LOCALE_OVERRIDE_COOKIE}=; Path=/; Max-Age=0`;
    vi.useRealTimers();
  });

  it("flushes locale changes immediately with keepalive so reload does not drop the save", async () => {
    await act(async () => {
      root.render(
        <SettingsRouteProvider
          value={{
            isDemo: false,
            locale: "zh-TW",
            profile: {
              userId: "user-1",
              displayName: null,
              email: "user@example.com",
              providerPictureUrl: null,
              providerDisplayName: null,
              userDisplayName: null,
              userPictureUrl: null,
              linkedAt: null,
              lastSeenAt: null,
              role: "admin",
              impersonation: null,
            },
            initialSidebarOpen: true,
            initialSettings: buildSettings("zh-TW"),
          }}
        >
          <LocaleProbe />
          <GeneralSettingsClient />
        </SettingsRouteProvider>,
      );
    });

    const localeSelect = Array.from(container.querySelectorAll("select"))
      .find((select) => select.value === "zh-TW") as HTMLSelectElement | undefined;
    expect(localeSelect).toBeTruthy();

    await act(async () => {
      localeSelect!.value = "en";
      localeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockPatchSettings).toHaveBeenCalledTimes(1);
    expect(mockPatchSettings).toHaveBeenCalledWith({ locale: "en" }, { keepalive: true });
    expect(document.cookie).toContain(`${LOCALE_OVERRIDE_COOKIE}=en`);
    expect(
      container.querySelector('[data-testid="route-locale"]')?.textContent,
    ).toBe("en");

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });

    expect(mockPatchSettings).toHaveBeenCalledTimes(1);
  });
});
