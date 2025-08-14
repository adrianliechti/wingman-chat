import { useChat } from './useChat';

/**
 * Hook that provides easy methods to show different types of chat activities
 * 
 * Usage examples:
 * const { showThinking, showProcessing, showUploading } = useChatActivity();
 * 
 * showThinking('Analyzing your request...');
 * showProcessing('Processing document', 'Converting to PDF');
 * showUploading('file.txt', 'Uploading to server');
 */
export function useChatActivity() {
  const { createActivity, updateActivityStatus, clearActivity } = useChat();

  const showThinking = (message: string) => {
    const activity = createActivity('thinking', 'Thinking', message);
    return activity;
  };

  const showProcessing = (title: string, description?: string) => {
    const activity = createActivity('processing', title, description);
    return activity;
  };

  const showUploading = (filename: string, description?: string) => {
    const activity = createActivity('uploading', `Uploading ${filename}`, description);
    return activity;
  };

  const showDownloading = (filename: string, description?: string) => {
    const activity = createActivity('downloading', `Downloading ${filename}`, description);
    return activity;
  };

  const completeActivity = () => {
    updateActivityStatus('completed');
  };

  const failActivity = () => {
    updateActivityStatus('failed');
  };

  return {
    showThinking,
    showProcessing,
    showUploading,
    showDownloading,
    completeActivity,
    failActivity,
    clearActivity
  };
}
