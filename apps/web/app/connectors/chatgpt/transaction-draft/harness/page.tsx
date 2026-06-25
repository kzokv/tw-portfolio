import { headers } from "next/headers";
import { ChatGptTransactionDraftWidgetHarnessClient } from "../../../../../components/chatgpt/ChatGptTransactionDraftWidgetHarnessClient";
import { resolveAuthLocale } from "../../../../../lib/authPages";

export const metadata = {
  title: "Vakwen ChatGPT Transaction Draft Harness",
  description: "Local mocked window.openai harness for the Vakwen ChatGPT transaction draft component.",
};

export default async function ChatGptTransactionDraftHarnessPage() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  return <ChatGptTransactionDraftWidgetHarnessClient locale={locale} />;
}
