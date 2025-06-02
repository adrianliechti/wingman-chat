import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { Button } from '@headlessui/react';
import { getConfig } from '../config';
import { Message, Role } from '../models/chat';

type RelatedPromptListProps = {
  prompt: string;
  model: string;

  onClick: (message: Message) => void;
};

export function RelatedPromptList({ prompt, model, onClick }: RelatedPromptListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [relatedPrompts, setRelatedPrompts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const config = getConfig();
  const client = config.client;

  const loadRelatedPrompts = async () => {
    if (hasLoaded || isLoading) return;
    
    setIsLoading(true);
    try {
      const prompts = await client.relatedPrompts(model, prompt);
      // Limit to 5 prompts to avoid overwhelming the UI
      setRelatedPrompts(prompts.slice(0, 5));
      setHasLoaded(true);
    } catch (error) {
      console.error('Failed to load related prompts:', error);
      setRelatedPrompts([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = () => {
    if (!isExpanded && !hasLoaded) {
      loadRelatedPrompts();
    }
    setIsExpanded(!isExpanded);
  };

  const handlePromptClick = (selectedPrompt: string) => {
    const message: Message = {
      role: Role.User,
      model: model,
      content: selectedPrompt,
    };

    onClick(message);
  };

  // Don't render if prompt is too short, empty, or seems incomplete
  if (!prompt || prompt.trim().length < 10 || prompt.trim().endsWith('...') || prompt === '') {
    return null;
  }

  return (
    <div className="mt-3 border-t border-neutral-200 dark:border-neutral-700 pt-3">
      <Button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full text-left text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors focus:outline-none p-2 -m-2 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <MessageSquare className="w-4 h-4" />
        <span>
          Related
        </span>
        {isLoading && (
          <div className="w-3 h-3 border border-neutral-400 border-t-transparent rounded-full animate-spin" />
        )}
      </Button>

      {isExpanded && (
        <div className="mt-3 space-y-2 animate-in fade-in duration-200">
          {isLoading ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2 py-3">
              Loading related prompts...
            </div>
          ) : relatedPrompts.length > 0 ? (
            relatedPrompts.map((relatedPrompt, index) => (
              <Button
                key={index}
                onClick={() => handlePromptClick(relatedPrompt)}
                className="block w-full text-left text-sm p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 cursor-pointer"
              >
                <div className="text-neutral-700 dark:text-neutral-300 leading-relaxed">
                  {relatedPrompt}
                </div>
              </Button>
            ))
          ) : hasLoaded ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2 py-3">
              No related prompts found.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
