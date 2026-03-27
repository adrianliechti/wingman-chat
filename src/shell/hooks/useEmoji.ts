import { useContext } from "react";
import { EmojiContext } from "@/shell/context/EmojiContext";

export const useEmoji = () => {
  const context = useContext(EmojiContext);
  if (context === undefined) {
    throw new Error("useEmoji must be used within an EmojiProvider");
  }
  return context;
};
