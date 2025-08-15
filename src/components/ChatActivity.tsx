import { Loader2, CheckCircle, XCircle } from "lucide-react";
import type { ChatActivity } from "../types/chat";

interface ChatActivityProps {
  activity: ChatActivity;
}

export function ChatActivityComponent({ activity }: ChatActivityProps) {
  const getStatusIcon = () => {
    switch (activity.status) {
      case 'active':
        return <Loader2 size={16} className="animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'failed':
        return <XCircle size={16} className="text-red-500" />;
    }
  };

  return (
    <div className="flex justify-start mb-4">
      <div className="flex-1 py-3">
        <div className={`
          flex items-center gap-3 px-0 py-2
          transition-all duration-300 ease-in-out
          ${activity.status === 'active' ? 'opacity-100' : 
            activity.status === 'completed' ? 'opacity-70' : 
            'opacity-70'}
        `}>
          {getStatusIcon()}
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {activity.title}
                {activity.status === 'active' && '...'}
              </span>
            </div>
            
            {activity.description && (
              <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 truncate">
                {activity.description}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
