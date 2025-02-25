import { Dot } from "lucide-react";

export function ThinkingIndicator() {
  return (
    <div className="flex space-x-1 justify-left">
      <div className="px-3 pt-4 pb-2 rounded-lg bg-muted">
        <div className="flex -space-x-2.5">
          <Dot className="w-5 h-5 animate-typing-dot-bounce" />
          <Dot className="h-5 w-5 animate-typing-dot-bounce [animation-delay:90ms]" />
          <Dot className="h-5 w-5 animate-typing-dot-bounce [animation-delay:180ms]" />
        </div>
      </div>
    </div>
  );
}
