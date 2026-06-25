import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPaletteProvider } from "../../../components/layout/CommandPaletteContext";
import { CommandPaletteTrigger } from "../../../components/layout/CommandPaletteTrigger";
import { ProfileMenu } from "../../../components/profile/ProfileMenu";

const mockSetTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: mockSetTheme }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("shell localization guardrails", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockSetTheme.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders localized command palette trigger labels", async () => {
    await act(async () => {
      root.render(
        <CommandPaletteProvider
          value={{ open: false, setOpen: vi.fn(), openWithQuery: vi.fn() }}
        >
          <CommandPaletteTrigger
            label="搜尋任何項目…"
            ariaLabel="開啟指令面板"
            className="!inline-flex !w-auto !px-3"
          />
        </CommandPaletteProvider>,
      );
    });

    const trigger = document.querySelector("[data-testid='topbar-command-trigger']");
    expect(trigger?.getAttribute("aria-label")).toBe("開啟指令面板");
    expect(trigger?.textContent).toContain("搜尋任何項目…");
  });

  it("renders localized profile-menu labels when the shell provides them", async () => {
    await act(async () => {
      root.render(
        <ProfileMenu
          displayName="測試使用者"
          email="tester@example.com"
          role="admin"
          onOpenProfile={() => undefined}
          signOutHref="/api/logout"
          labels={{
            profileLink: "個人檔案",
            adminLink: "管理",
            signOut: "登出",
            themeLight: "淺色",
            themeSystem: "系統",
            themeDark: "深色",
          }}
        />,
      );
    });

    const trigger = document.querySelector("[data-testid='topbar-profile-menu-trigger']");
    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });

    expect(document.body.textContent).toContain("個人檔案");
    expect(document.body.textContent).toContain("管理");
    expect(document.body.textContent).toContain("登出");
    expect(document.body.textContent).toContain("淺色");
    expect(document.body.textContent).toContain("系統");
    expect(document.body.textContent).toContain("深色");
  });
});
