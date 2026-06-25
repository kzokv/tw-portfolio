import { headers } from "next/headers";
import { ChatGptTransactionDraftWidget } from "../../../../components/chatgpt/ChatGptTransactionDraftWidget";
import { resolveAuthLocale } from "../../../../lib/authPages";

export const metadata = {
  title: "Vakwen ChatGPT Transaction Draft",
  description: "Public ChatGPT component shell for Vakwen transaction draft review and posting.",
};

export default async function ChatGptTransactionDraftPage() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  return <ChatGptTransactionDraftWidget locale={locale} />;
}
