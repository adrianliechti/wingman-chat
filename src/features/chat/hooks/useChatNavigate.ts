import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

export function useChatNavigate() {
  const navigate = useNavigate();

  const newChat = useCallback(() => {
    navigate({ to: '/chat' });
  }, [navigate]);

  const openChat = useCallback((chatId: string) => {
    navigate({ to: '/chat/$chatId', params: { chatId } });
  }, [navigate]);

  return { newChat, openChat };
}
