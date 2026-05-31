import { ChatGptTransactionDraftWidget } from "../../../../components/chatgpt/ChatGptTransactionDraftWidget";

export const metadata = {
  title: "Vakwen ChatGPT Transaction Draft",
  description: "Public ChatGPT component shell for Vakwen transaction draft review and posting.",
};

export default function ChatGptTransactionDraftPage() {
  return <ChatGptTransactionDraftWidget />;
}
