"use client";

import { useMemo } from "react";
import { AppShell } from "../../components/layout/AppShell";
import { SharingClient } from "../../components/sharing/SharingClient";
import { useSharingRouteContext } from "../../components/sharing/SharingRouteProvider";
import { getDictionary } from "../../lib/i18n";

export default function SharingPage() {
  const { isDemo, locale, profile } = useSharingRouteContext();
  const dict = useMemo(() => getDictionary(locale), [locale]);

  return (
    <AppShell
      isDemo={isDemo}
      localeOverride={locale}
      titleOverride={dict.sharing.pageTitle}
      descriptionOverride={dict.sharing.pageDescription}
      activeSectionOverride={null}
    >
      <SharingClient
        locale={locale}
        isDemo={isDemo}
        role={profile.role}
      />
    </AppShell>
  );
}
