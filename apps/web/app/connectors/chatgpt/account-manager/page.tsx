import { headers } from "next/headers";
import { ChatGptAccountManagerWidget } from "../../../../components/chatgpt/ChatGptAccountManagerWidget";
import { resolveAuthLocale } from "../../../../lib/authPages";

export const metadata = {
  title: "Vakwen ChatGPT Account Manager",
  description: "Public ChatGPT component shell for Vakwen account management.",
};

export default async function ChatGptAccountManagerPage() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  return <ChatGptAccountManagerWidget locale={locale} />;
}
