import { headers } from "next/headers";
import { ChatGptAccountManagerWidgetHarnessClient } from "../../../../../components/chatgpt/ChatGptAccountManagerWidgetHarnessClient";
import { resolveAuthLocale } from "../../../../../lib/authPages";

export const metadata = {
  title: "Vakwen ChatGPT Account Manager Harness",
  description: "Local mocked window.openai harness for the Vakwen ChatGPT account manager component.",
};

export default async function ChatGptAccountManagerHarnessPage() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  return <ChatGptAccountManagerWidgetHarnessClient locale={locale} />;
}
