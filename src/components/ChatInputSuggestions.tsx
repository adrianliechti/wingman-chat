import { memo } from "react";
import { Button } from '@headlessui/react';

interface ChatInputSuggestionsProps {
  show: boolean;
  loading: boolean;
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export const ChatInputSuggestions = memo(({ 
  show, 
  suggestions, 
  onSelect 
}: ChatInputSuggestionsProps) => {
  if (!show || suggestions.length === 0) {
    return null;
  }
  
  return (
    <div className="p-3">
      <div className="space-y-2">
        {suggestions.map((suggestion, index) => (
          <Button
            key={index}
            type="button"
            onClick={() => onSelect(suggestion)}
            className="w-full text-left p-3 text-sm bg-white/25 dark:bg-black/15 backdrop-blur-lg hover:bg-white/40 dark:hover:bg-black/25 rounded-lg border border-white/30 dark:border-white/20 transition-colors focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
});

ChatInputSuggestions.displayName = 'ChatInputSuggestions';
