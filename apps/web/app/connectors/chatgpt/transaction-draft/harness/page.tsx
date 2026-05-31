import { ChatGptTransactionDraftWidgetHarnessClient } from "../../../../../components/chatgpt/ChatGptTransactionDraftWidgetHarnessClient";

export const metadata = {
  title: "Vakwen ChatGPT Transaction Draft Harness",
  description: "Local mocked window.openai harness for the Vakwen ChatGPT transaction draft component.",
};

export default function ChatGptTransactionDraftHarnessPage() {
  return <ChatGptTransactionDraftWidgetHarnessClient />;
}
