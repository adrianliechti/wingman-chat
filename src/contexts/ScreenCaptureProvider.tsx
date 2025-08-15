import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ScreenCaptureContext } from './ScreenCaptureContext';
import type { ScreenCaptureContextType } from './ScreenCaptureContext';
import { getConfig } from '../config';

interface ScreenCaptureProviderProps {
  children: ReactNode;
}

// Check if screen capture is supported by the browser
function supportsScreenCapture(): boolean {
  return "mediaDevices" in navigator && "getDisplayMedia" in navigator.mediaDevices;
}

export function ScreenCaptureProvider({ children }: ScreenCaptureProviderProps) {
  const [isActive, setIsActive] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  
  // Check if screen capture is available (both supported by browser and enabled in config)
  // This combines browser capability check with config.vision setting
  const isAvailable = useMemo(() => {
    const config = getConfig();
    return config.vision && supportsScreenCapture();
  }, []);

  // Helper to clean up resources
  const cleanupResources = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    
    setIsActive(false);
  }, []);

  const stopCapture = useCallback(() => {
    cleanupResources();
  }, [cleanupResources]);

  const startCapture = useCallback(async () => {
    // Clean up any existing capture first
    cleanupResources();

    try {
      // Request screen capture permission
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          cursor: 'always'
        } as MediaTrackConstraints,
        audio: false,
      });

      streamRef.current = stream;

      // Create video element for capturing frames
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      
      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play()
            .then(() => resolve())
            .catch(reject);
        };
        video.onerror = () => reject(new Error('Failed to load video stream'));
      });

      videoRef.current = video;
      setIsActive(true);

      // Handle user stopping the share via browser UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          console.log('Screen sharing ended by user');
          cleanupResources();
        });
      }
    } catch (error) {
      console.error('Failed to start screen capture:', error);
      cleanupResources();
      
      // Provide user-friendly error messages
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          throw new Error('Screen capture permission was denied');
        } else if (error.name === 'NotFoundError') {
          throw new Error('No screen capture source was selected');
        }
      }
      throw error;
    }
  }, [cleanupResources]);

  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    if (!streamRef.current || !videoRef.current) {
      console.warn('No active screen capture stream');
      return null;
    }

    const video = videoRef.current;
    const stream = streamRef.current;

    // Check if stream is still active
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      console.warn('Screen capture stream is not active');
      cleanupResources();
      return null;
    }

    try {
      // Create canvas with video dimensions
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (blob) => resolve(blob),
          'image/png',
          1.0 // Maximum quality
        );
      });
    } catch (error) {
      console.error('Failed to capture frame:', error);
      return null;
    }
  }, [cleanupResources]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  const value: ScreenCaptureContextType = {
    isAvailable,
    isActive,
    startCapture,
    stopCapture,
    captureFrame,
  };

  return (
    <ScreenCaptureContext.Provider value={value}>
      {children}
    </ScreenCaptureContext.Provider>
  );
}
