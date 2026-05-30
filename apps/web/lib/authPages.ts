export type AuthPageLocale = "en" | "zh-TW";
export type InviteStatus = "valid" | "invalid" | "expired" | "used" | "revoked";
export type AuthErrorReason =
  | "invalid_state"
  | "oauth_error"
  | "server_error"
  | "session_expired"
  | "insecure_transport"
  | "account_disabled"
  | "invite_required"
  | "invalid_code"
  | "expired_code"
  | "email_mismatch"
  | "already_used"
  | "revoked";

type AuthMessage = {
  title: string;
  description: string;
  linkText?: string;
};

type InviteStatusMessage = {
  title: string;
  description: string;
};

interface AuthPageDictionary {
  defaultError: AuthMessage;
  errorReasons: Record<AuthErrorReason, AuthMessage>;
	  shared: {
	    terms: string;
	    privacy: string;
	    termsPrivacyPrefix: string;
	    backHome: string;
	  };
	  login: {
	    demoExpired: string;
	    title: string;
	    description: string;
	    signIn: string;
	    connecting: string;
	    apiUnreachable: string;
	    separator: string;
	    demoLabel: string;
	    demoLoadingLabel: string;
	    demoRateLimited: string;
	    demoFailed: string;
	    demoNetworkError: string;
	  };
	  invite: {
    valid: InviteStatusMessage;
    unavailable: InviteStatusMessage;
    statuses: Record<Exclude<InviteStatus, "valid">, InviteStatusMessage>;
    signedInTitle: string;
    signedInDescription: string;
    signedInIdentityFallback: string;
    signOut: string;
	    dashboard: string;
	    signIn: string;
	    connecting: string;
	    apiUnreachable: string;
	    codeLabel: string;
	    statusLabel: string;
	  };
}

export const authPageCopy: Record<AuthPageLocale, AuthPageDictionary> = {
  en: {
	    shared: {
	      terms: "Terms",
	      privacy: "Privacy",
	      termsPrivacyPrefix: "By continuing you agree to our",
	      backHome: "Back to home",
	    },
	    login: {
	      demoExpired: "Your demo session has ended. Sign in to keep your data.",
	      title: "Sign in to Vakwen",
	      description: "Track your multi-market portfolio. Bring your own data.",
	      signIn: "Sign in with Google",
	      connecting: "Connecting...",
	      apiUnreachable:
	        "Cannot reach the API server. If your API runs in a Docker container, create an SSH tunnel forwarding the API port (e.g. -L 4300:192.168.64.1:4300 - replace the IP with your Docker host IP).",
	      separator: "or",
	      demoLabel: "Try it - no sign-up needed",
	      demoLoadingLabel: "Starting demo...",
	      demoRateLimited: "Too many demo sessions. Please wait a minute and try again.",
	      demoFailed: "Failed to start demo session.",
	      demoNetworkError: "Cannot reach the server. Please try again.",
	    },
    defaultError: {
      title: "Sign-in failed",
      description: "An unexpected error occurred during sign-in. Please try again.",
      linkText: "Try again",
    },
    errorReasons: {
      invalid_state: {
        title: "Sign-in failed",
        description: "The sign-in request was invalid or expired. Please try again.",
      },
      oauth_error: {
        title: "Sign-in cancelled",
        description: "Google reported an error during sign-in. Please try again.",
      },
      server_error: {
        title: "Something went wrong",
        description: "A server error occurred during sign-in. Please try again in a moment.",
      },
      session_expired: {
        title: "Your session has expired",
        description: "Please sign in again to continue.",
        linkText: "Sign in again",
      },
      insecure_transport: {
        title: "Session cookie rejected",
        description:
          "Your browser rejected the session cookie because you're accessing the app over HTTP, but the cookie requires HTTPS (Secure flag). To fix this, set NODE_ENV=test in your Docker env file (infra/docker/.env.local) and rebuild.",
        linkText: "Back to login",
      },
      account_disabled: {
        title: "Account unavailable",
        description: "This account has been disabled. Please contact an administrator if you believe this is a mistake.",
        linkText: "Back to login",
      },
      invite_required: {
        title: "Invite required",
        description: "This email address needs a valid invite before it can sign in.",
        linkText: "Back to login",
      },
      invalid_code: {
        title: "Invite not found",
        description: "This invite link is invalid or no longer exists.",
        linkText: "Back to login",
      },
      expired_code: {
        title: "Invite expired",
        description: "This invite link has expired. Ask an admin for a new invite.",
        linkText: "Back to login",
      },
      email_mismatch: {
        title: "Invite email mismatch",
        description: "Sign in with the same Google account that received the invite email.",
        linkText: "Back to login",
      },
      already_used: {
        title: "Invite already used",
        description: "This invite link has already been accepted.",
        linkText: "Back to login",
      },
      revoked: {
        title: "Invite revoked",
        description: "This invite link has been revoked by an admin.",
        linkText: "Back to login",
      },
    },
    invite: {
      valid: {
        title: "Accept your invite",
        description: "Sign in with Google using the email address that received this invite.",
      },
      unavailable: {
        title: "Invite unavailable",
        description: "We couldn't verify this invite right now. Please try again in a moment.",
      },
      statuses: {
        invalid: {
          title: "Invite not found",
          description: "This invite link is invalid or no longer exists.",
        },
        expired: {
          title: "Invite expired",
          description: "This invite link has expired. Ask an admin for a new invite.",
        },
        used: {
          title: "Invite already used",
          description: "This invite link has already been accepted.",
        },
        revoked: {
          title: "Invite revoked",
          description: "This invite link has been revoked by an admin.",
        },
      },
      signedInTitle: "You’re already signed in",
      signedInDescription:
        "You’re already signed in as {email}. This invite is for a different account. Sign out to accept, or return to dashboard.",
      signedInIdentityFallback: "your current account",
      signOut: "Sign out",
      dashboard: "Dashboard",
	      signIn: "Sign in with Google",
	      connecting: "Connecting…",
	      apiUnreachable:
	        "Cannot reach the API server. If your API runs in a Docker container, create an SSH tunnel forwarding the API port (e.g. -L 4300:192.168.64.1:4300 — replace the IP with your Docker host IP).",
	      codeLabel: "Invitation code",
	      statusLabel: "Invite status",
	    },
  },
  "zh-TW": {
	    shared: {
	      terms: "服務條款",
	      privacy: "隱私權政策",
	      termsPrivacyPrefix: "繼續使用即表示你同意我們的",
	      backHome: "返回首頁",
	    },
	    login: {
	      demoExpired: "示範工作階段已結束。登入即可保留你的資料。",
	      title: "登入 Vakwen",
	      description: "追蹤你的多市場投資組合，使用自己的資料開始。",
	      signIn: "使用 Google 登入",
	      connecting: "連線中...",
	      apiUnreachable:
	        "目前無法連到 API 伺服器。如果 API 跑在 Docker 容器裡，請建立 SSH tunnel 轉送 API 埠（例如 -L 4300:192.168.64.1:4300，請依你的 Docker host IP 調整）。",
	      separator: "或",
	      demoLabel: "免註冊試用",
	      demoLoadingLabel: "正在啟動示範...",
	      demoRateLimited: "示範工作階段建立過於頻繁，請稍後再試。",
	      demoFailed: "示範工作階段啟動失敗。",
	      demoNetworkError: "目前無法連到伺服器，請稍後再試。",
	    },
    defaultError: {
      title: "登入失敗",
      description: "登入時發生未預期錯誤，請稍後再試一次。",
      linkText: "再試一次",
    },
    errorReasons: {
      invalid_state: {
        title: "登入失敗",
        description: "此次登入請求已失效或格式不正確，請重新再試。",
      },
      oauth_error: {
        title: "登入已取消",
        description: "Google 在登入過程中回傳錯誤，請重新再試。",
      },
      server_error: {
        title: "系統發生錯誤",
        description: "登入過程中發生伺服器錯誤，請稍後再試。",
      },
      session_expired: {
        title: "工作階段已過期",
        description: "請重新登入後再繼續。",
        linkText: "重新登入",
      },
      insecure_transport: {
        title: "工作階段 Cookie 被拒絕",
        description:
          "瀏覽器拒絕了工作階段 Cookie，因為你目前使用 HTTP 存取，而該 Cookie 需要 HTTPS（Secure flag）。請在 Docker 環境檔（infra/docker/.env.local）設定 NODE_ENV=test，然後重新建置。",
        linkText: "回到登入頁",
      },
      account_disabled: {
        title: "帳號已停用",
        description: "這個帳號已被停用。如認為有誤，請聯絡管理員。",
        linkText: "回到登入頁",
      },
      invite_required: {
        title: "需要邀請才能登入",
        description: "這個電子郵件地址需要有效邀請，才能完成登入。",
        linkText: "回到登入頁",
      },
      invalid_code: {
        title: "找不到邀請",
        description: "這個邀請連結無效，或已不存在。",
        linkText: "回到登入頁",
      },
      expired_code: {
        title: "邀請已過期",
        description: "這個邀請連結已過期，請向管理員索取新的邀請。",
        linkText: "回到登入頁",
      },
      email_mismatch: {
        title: "邀請帳號不符",
        description: "請使用收到邀請信的同一個 Google 帳號登入。",
        linkText: "回到登入頁",
      },
      already_used: {
        title: "邀請已使用",
        description: "這個邀請連結已經被接受。",
        linkText: "回到登入頁",
      },
      revoked: {
        title: "邀請已撤銷",
        description: "這個邀請連結已被管理員撤銷。",
        linkText: "回到登入頁",
      },
    },
    invite: {
      valid: {
        title: "接受邀請",
        description: "請使用收到邀請信的 Google 帳號登入。",
      },
      unavailable: {
        title: "邀請暫時無法驗證",
        description: "目前無法驗證這個邀請，請稍後再試。",
      },
      statuses: {
        invalid: {
          title: "找不到邀請",
          description: "這個邀請連結無效，或已不存在。",
        },
        expired: {
          title: "邀請已過期",
          description: "這個邀請連結已過期，請向管理員索取新的邀請。",
        },
        used: {
          title: "邀請已使用",
          description: "這個邀請連結已經被接受。",
        },
        revoked: {
          title: "邀請已撤銷",
          description: "這個邀請連結已被管理員撤銷。",
        },
      },
      signedInTitle: "你已經登入",
      signedInDescription:
        "你目前已使用 {email} 登入。這份邀請是給其他帳號使用；請先登出後再接受，或直接返回儀表板。",
      signedInIdentityFallback: "目前帳號",
      signOut: "登出",
      dashboard: "前往儀表板",
	      signIn: "使用 Google 登入",
	      connecting: "連線中…",
	      apiUnreachable:
	        "目前無法連到 API 伺服器。如果 API 跑在 Docker 容器裡，請建立 SSH tunnel 轉送 API 埠（例如 -L 4300:192.168.64.1:4300，請依你的 Docker host IP 調整）。",
	      codeLabel: "邀請代碼",
	      statusLabel: "邀請狀態",
	    },
  },
};

export function resolveAuthLocale(acceptLanguage: string | null | undefined): AuthPageLocale {
  if (!acceptLanguage) return "en";

  const normalized = acceptLanguage.toLowerCase();
  if (normalized.includes("zh-tw") || normalized.includes("zh-hant") || normalized.startsWith("zh")) {
    return "zh-TW";
  }

  return "en";
}
