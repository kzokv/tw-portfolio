import { ChatGptAccountManagerWidgetHarnessClient } from "../../../../../components/chatgpt/ChatGptAccountManagerWidgetHarnessClient";

export const metadata = {
  title: "Vakwen ChatGPT Account Manager Harness",
  description: "Local mocked window.openai harness for the Vakwen ChatGPT account manager component.",
};

export default function ChatGptAccountManagerHarnessPage() {
  return <ChatGptAccountManagerWidgetHarnessClient />;
}
