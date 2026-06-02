import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import { E2E_ENDPOINTS } from "../../constants/index.js";
import { extractCookieValue } from "../../utils/cookie.js";
import { apiUrl, appUrl } from "../../utils/url.js";
import type { BrowserSessionPage } from "../../pages/auth/BrowserSessionPage.js";

interface TOAuthCallbackOptions {
  code?: string;
  error?: string;
  maxRedirects?: number;
  state?: string;
}

type TUserRole = "admin" | "member" | "viewer";

export class SessionActions extends AppBaseActions {
  declare protected readonly _instance: BrowserSessionPage;

  @Step()
  async clearCookies(): Promise<void> {
    await this.mxClearCookies();
  }

  @Step()
  async navigateToAppPath(path: string): Promise<void> {
    await this.mxGotoUrl(appUrl(path));
  }

  @Step()
  async plantSessionCookie(value: string, mode: "domain" | "url" = "domain"): Promise<void> {
    const cookieName = TestEnv.sessionCookieName;
    const secure = cookieName.startsWith("__Host-");
    const cookie =
      mode === "url"
        ? {
            name: cookieName,
            value,
            url: TestEnv.appBaseUrl,
          }
        : {
            name: cookieName,
            value,
            domain: TestEnv.host,
            path: "/",
            httpOnly: true,
            secure,
            sameSite: "Lax" as const,
          };

    await this.mxAddCookies([cookie]);
  }

  @Step()
  async requestOAuthStart(
    returnTo?: string,
    inviteCode?: string,
  ): Promise<import("@playwright/test").APIResponse> {
    const params = new URLSearchParams();
    if (returnTo) {
      params.set("returnTo", returnTo);
    }
    if (inviteCode) {
      params.set("invite_code", inviteCode);
    }
    const path = params.size > 0 ? `/auth/google/start?${params.toString()}` : "/auth/google/start";
    return await this.request.get(apiUrl(path), { maxRedirects: 0 });
  }

  @Step()
  async requestOAuthCallback(options: TOAuthCallbackOptions): Promise<import("@playwright/test").APIResponse> {
    const params = new URLSearchParams();
    if (options.code) {
      params.set("code", options.code);
    }
    if (options.error) {
      params.set("error", options.error);
    }
    if (options.state) {
      params.set("state", options.state);
    }

    return await this.request.get(apiUrl(`/auth/google/callback?${params.toString()}`), {
      maxRedirects: options.maxRedirects ?? 0,
    });
  }

  @Step()
  async requestOAuthSession(idToken?: string): Promise<import("@playwright/test").APIResponse> {
    return await this.request.post(apiUrl(E2E_ENDPOINTS.OAUTH_SESSION), {
      ...(idToken ? { data: { id_token: idToken } } : {}),
    });
  }

  @Step()
  async requestInvite(
    email: string,
    role: TUserRole = "member",
    cookie?: string,
    expiresAt?: string,
  ): Promise<import("@playwright/test").APIResponse> {
    return await this.request.post(apiUrl("/invites"), {
      data: {
        email,
        role,
        ...(expiresAt ? { expiresAt } : {}),
      },
      ...(cookie ? { headers: { cookie } } : {}),
    });
  }

  @Step()
  async replaceSessionFromSetCookieHeader(
    setCookieHeader: string,
    mode: "domain" | "url" = "domain",
  ): Promise<void> {
    const cookieValue = extractCookieValue(setCookieHeader, TestEnv.sessionCookieName);
    if (!cookieValue) {
      throw new Error(`Session cookie "${TestEnv.sessionCookieName}" not found in Set-Cookie header`);
    }

    await this.clearCookies();
    await this.plantSessionCookie(cookieValue, mode);
  }

  @Step()
  async seedOAuthSession(idToken?: string, mode: "domain" | "url" = "domain"): Promise<import("@playwright/test").APIResponse> {
    const response = await this.requestOAuthSession(idToken);
    await this.replaceSessionFromSetCookieHeader(response.headers()["set-cookie"] ?? "", mode);
    return response;
  }

  @Step()
  async requestRefreshToken(refreshToken?: string, cookie = ""): Promise<import("@playwright/test").APIResponse> {
    return await this.request.post(apiUrl("/auth/token/refresh"), {
      data: refreshToken ? { refreshToken } : {},
      ...(cookie ? { headers: { cookie } } : {}),
    });
  }

  @Step()
  async requestNotifications(): Promise<import("@playwright/test").APIResponse> {
    return await this.request.get(apiUrl("/notifications"));
  }

  @Step()
  async requestNotificationUnreadCount(): Promise<import("@playwright/test").APIResponse> {
    return await this.request.get(apiUrl("/notifications/unread-count"));
  }

  @Step()
  async requestNotificationMarkRead(notificationId: string): Promise<import("@playwright/test").APIResponse> {
    return await this.request.patch(apiUrl(`/notifications/${notificationId}/read`), {
      data: {},
    });
  }

  @Step()
  async requestNotificationsMarkAllRead(): Promise<import("@playwright/test").APIResponse> {
    return await this.request.patch(apiUrl("/notifications/read-all"), {
      data: {},
    });
  }

  @Step()
  async requestNotificationDelete(notificationId: string): Promise<import("@playwright/test").APIResponse> {
    return await this.request.delete(apiUrl(`/notifications/${notificationId}`));
  }

  @Step()
  async requestNotificationEscalate(notificationId: string): Promise<import("@playwright/test").APIResponse> {
    return await this.request.patch(apiUrl(`/notifications/${notificationId}/escalate`), {
      data: {},
    });
  }

  @Step()
  async logoutViaApi(): Promise<void> {
    await this.mxGotoUrl(
      `http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`,
    ).catch(() => undefined);
  }

  @Step()
  async navigateToOAuthCallback(options: TOAuthCallbackOptions): Promise<void> {
    const params = new URLSearchParams();
    if (options.code) {
      params.set("code", options.code);
    }
    if (options.error) {
      params.set("error", options.error);
    }
    if (options.state) {
      params.set("state", options.state);
    }

    await this.mxGotoUrl(apiUrl(`/auth/google/callback?${params.toString()}`));
  }

  @Step()
  async stubDashboardEnrichmentUnauthorized(): Promise<void> {
    await this.page.route("**/dashboard/enrichment**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "authentication required" }),
      }));
  }
}
