import type { Chat } from "@/shared/types/chat";

/** Share an in-flight chat creation so concurrent message events use one chat. */
export function createChatCreationGate(): (createChat: () => Promise<Chat>) => Promise<Chat> {
  let pending: Promise<Chat> | null = null;

  return (createChat) => {
    if (pending) return pending;

    const creation = createChat();
    pending = creation;

    const clear = () => {
      if (pending === creation) pending = null;
    };
    void creation.then(clear, clear);

    return creation;
  };
}
