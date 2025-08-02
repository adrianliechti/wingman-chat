import { useContext } from 'react';
import { ScreenCaptureContext, ScreenCaptureContextType } from '../contexts/ScreenCaptureContext';

export function useScreenCapture(): ScreenCaptureContextType {
  const context = useContext(ScreenCaptureContext);
  
  if (context === undefined) {
    throw new Error('useScreenCapture must be used within a ScreenCaptureProvider');
  }
  
  return context;
}
