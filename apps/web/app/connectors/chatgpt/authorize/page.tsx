import { headers } from "next/headers";
import { ChatGptConnectorAuthorizeClient } from "../../../../components/connectors/ChatGptConnectorAuthorizeClient";
import { resolveAuthLocale } from "../../../../lib/authPages";

export default async function ChatGptConnectorAuthorizePage() {
  const headerStore = await headers();
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  return <ChatGptConnectorAuthorizeClient locale={locale} />;
}
