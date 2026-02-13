import { useContext } from 'react';
import { ScreenCaptureContext } from '@/features/chat/context/ScreenCaptureContext';
import type { ScreenCaptureContextType } from '@/features/chat/context/ScreenCaptureContext';

export function useScreenCapture(): ScreenCaptureContextType {
  const context = useContext(ScreenCaptureContext);
  
  if (context === undefined) {
    throw new Error('useScreenCapture must be used within a ScreenCaptureProvider');
  }
  
  return context;
}
