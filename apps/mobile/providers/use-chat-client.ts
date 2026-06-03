import { useContext } from "react";
import { ChatClientContext } from "./chat-client-utils";

export function useChatClient() {
  const context = useContext(ChatClientContext);
  if (!context) {
    throw new Error("useChatClient must be used inside ChatClientProvider.");
  }

  return context;
}
