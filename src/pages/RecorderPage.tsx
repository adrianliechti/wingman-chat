import { useState, useEffect, useRef, useCallback } from "react";
import { getConfig } from "../config";
import { CopyButton } from "../components/CopyButton";
import { Loader2, XIcon } from "lucide-react";

// Segment type for multi-segment audio
interface AudioSegment {
  blob: Blob;
  duration: number;
}

export function RecorderPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [toggleDirection, setToggleDirection] = useState<"up" | "down" | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const seekDirectionRef = useRef<"forward" | "backward" | null>(null);
  
  // Audio refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isStoppingRecordingRef = useRef(false);
  
  // Segment-based audio storage
  const segmentsRef = useRef<AudioSegment[]>([]);
  const recordingStartPositionRef = useRef<number>(0);
  const isPlayingRef = useRef(false); // Ref to check playing state in async callbacks
  const lastPositionRef = useRef<number>(0); // Track last position for smooth disc rotation
  const playbackBlobRef = useRef<{ blob: Blob; url: string } | null>(null); // Merged blob for playback
  
  // Keep duration in a ref to avoid stale closures in callbacks
  const durationRef = useRef(0);
  
  // Update durationRef whenever duration changes
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  
  // Disc dragging state
  const [isDraggingDisc, setIsDraggingDisc] = useState(false);
  const [discRotation, setDiscRotation] = useState(0);
  const lastAngleRef = useRef<number | null>(null);
  const discCenterRef = useRef({ x: 200, y: 220 });
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Drag and drop state
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  
  // Transcription state
  const [transcriptionText, setTranscriptionText] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Format seconds to HH:mm:ss
  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return '00:00:00';
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Calculate angle from center of disc to mouse position
  const getAngleFromCenter = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return 0;
    const svgRect = svgRef.current.getBoundingClientRect();
    const scaleX = 400 / svgRect.width;
    const scaleY = 520 / svgRect.height;
    const x = (clientX - svgRect.left) * scaleX - discCenterRef.current.x;
    const y = (clientY - svgRect.top) * scaleY - discCenterRef.current.y;
    return Math.atan2(y, x) * (180 / Math.PI);
  }, []);

  // Handle disc mouse/touch start
  const handleDiscStart = useCallback((clientX: number, clientY: number) => {
    setIsDraggingDisc(true);
    lastAngleRef.current = getAngleFromCenter(clientX, clientY);
    
    // Pause playback while scrubbing
    if (isPlaying && audioElementRef.current) {
      audioElementRef.current.pause();
    }
  }, [getAngleFromCenter, isPlaying]);

  // Handle disc mouse/touch move
  const handleDiscMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingDisc || lastAngleRef.current === null) return;
    
    const currentAngle = getAngleFromCenter(clientX, clientY);
    let deltaAngle = currentAngle - lastAngleRef.current;
    
    // Handle wrap-around at 180/-180 degrees
    if (deltaAngle > 180) deltaAngle -= 360;
    if (deltaAngle < -180) deltaAngle += 360;
    
    // Update rotation directly with mouse movement (1:1 ratio for natural feel)
    setDiscRotation(prev => prev + deltaAngle);
    // Scale rotation to time - faster spinning = faster scrubbing
    // Clamp to valid duration range (use ref to avoid stale closure)
    const currentDuration = durationRef.current;
    setPosition(prev => {
      const newPos = Math.max(0, Math.min(currentDuration, prev + deltaAngle * 0.1));
      lastPositionRef.current = newPos;
      return newPos;
    });
    
    lastAngleRef.current = currentAngle;
  }, [isDraggingDisc, getAngleFromCenter]);

  // Handle disc mouse/touch end
  const handleDiscEnd = useCallback(() => {
    // If we were playing before scrubbing, resume playback at new position
    if (isPlaying && audioElementRef.current && segmentsRef.current.length > 0) {
      audioElementRef.current.currentTime = position;
      audioElementRef.current.play();
    }
    setIsDraggingDisc(false);
    lastAngleRef.current = null;
  }, [isPlaying, position]);

  // Global mouse/touch move and end handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleDiscMove(e.clientX, e.clientY);
    };
    
    const handleMouseUp = () => {
      handleDiscEnd();
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleDiscMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    
    const handleTouchEnd = () => {
      handleDiscEnd();
    };
    
    if (isDraggingDisc) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleTouchEnd);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDraggingDisc, handleDiscMove, handleDiscEnd]);

  // Initialize audio element for playback (only once)
  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener('ended', () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      // Set position to end
      setPosition(durationRef.current);
      lastPositionRef.current = durationRef.current;
    });
    audio.addEventListener('timeupdate', () => {
      if (audioElementRef.current && isPlayingRef.current) {
        const currentTime = audioElementRef.current.currentTime;
        if (Number.isFinite(currentTime)) {
          // Update disc rotation based on position change
          const delta = currentTime - lastPositionRef.current;
          if (Math.abs(delta) < 1) { // Only smooth updates, not jumps
            setDiscRotation(prev => prev + delta * 360); // 1 second = 360 degrees
          }
          lastPositionRef.current = currentTime;
          setPosition(currentTime);
        }
      }
    });
    audioElementRef.current = audio;
    
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Timer effect for recording
  useEffect(() => {
    let animationFrameId: number | null = null;
    let isCancelled = false;
    
    if (isRecording) {
      const updateTime = () => {
        if (isCancelled || isStoppingRecordingRef.current) return;
        const elapsed = (Date.now() - recordingStartTimeRef.current) / 1000;
        const newPosition = recordingStartPositionRef.current + elapsed;
        
        // Update disc rotation based on position change
        const delta = newPosition - lastPositionRef.current;
        if (Math.abs(delta) < 1) { // Only smooth updates, not jumps
          setDiscRotation(prev => prev + delta * 360); // 1 second = 360 degrees
        }
        lastPositionRef.current = newPosition;
        
        setPosition(newPosition);
        setDuration(prev => Math.max(prev, newPosition));
        animationFrameId = requestAnimationFrame(updateTime);
      };
      animationFrameId = requestAnimationFrame(updateTime);
    }
    
    return () => {
      isCancelled = true;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isRecording]);

  // Calculate total duration from all segments
  const calculateTotalDuration = useCallback(() => {
    let total = 0;
    for (const segment of segmentsRef.current) {
      total += segment.duration;
    }
    return total;
  }, []);

  // Build merged audio blob from all segments for playback
  const buildPlaybackBlob = useCallback(async (): Promise<{ blob: Blob; url: string } | null> => {
    if (segmentsRef.current.length === 0) return null;
    
    // Revoke old URL if exists
    if (playbackBlobRef.current?.url) {
      URL.revokeObjectURL(playbackBlobRef.current.url);
    }
    
    // If only one segment, use it directly
    if (segmentsRef.current.length === 1) {
      const url = URL.createObjectURL(segmentsRef.current[0].blob);
      playbackBlobRef.current = { blob: segmentsRef.current[0].blob, url };
      return playbackBlobRef.current;
    }
    
    // For multiple segments, decode and merge into WAV
    const audioContext = new AudioContext();
    const audioBuffers: AudioBuffer[] = [];
    
    for (const segment of segmentsRef.current) {
      const arrayBuffer = await segment.blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      audioBuffers.push(decoded);
    }
    
    // Calculate total length
    let totalLength = 0;
    const sampleRate = audioBuffers[0].sampleRate;
    for (const buf of audioBuffers) {
      totalLength += buf.length;
    }
    
    // Create merged buffer
    const mergedBuffer = audioContext.createBuffer(1, totalLength, sampleRate);
    const mergedData = mergedBuffer.getChannelData(0);
    let offset = 0;
    
    for (const buf of audioBuffers) {
      const sourceData = buf.getChannelData(0);
      for (let i = 0; i < buf.length; i++) {
        mergedData[offset + i] = sourceData[i];
      }
      offset += buf.length;
    }
    
    // Encode to WAV
    const wavBlob = audioBufferToWav(mergedBuffer);
    const url = URL.createObjectURL(wavBlob);
    
    await audioContext.close();
    
    playbackBlobRef.current = { blob: wavBlob, url };
    return playbackBlobRef.current;
  }, []);

  // Helper to convert AudioBuffer to WAV blob
  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = 1;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const data = buffer.getChannelData(0);
    const dataLength = data.length * (bitDepth / 8);
    const headerLength = 44;
    const totalLength = headerLength + dataLength;
    
    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (viewOffset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(viewOffset + i, str.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write audio data
    let writeOffset = 44;
    for (let i = 0; i < data.length; i++) {
      const sample = Math.max(-1, Math.min(1, data[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(writeOffset, intSample, true);
      writeOffset += 2;
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  // Seeking effect for fast forward/rewind
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    
    if (isSeeking && seekDirectionRef.current) {
      interval = setInterval(() => {
        const direction = seekDirectionRef.current === "forward" ? 1 : -1;
        setPosition((prev) => {
          // Use durationRef to get current duration to avoid stale closures
          const currentDuration = durationRef.current;
          if (currentDuration <= 0) return prev;
          const newPos = Math.max(0, Math.min(currentDuration, prev + direction));
          if ((direction > 0 && newPos > prev) || (direction < 0 && newPos < prev)) {
            setDiscRotation((prevRot) => prevRot + direction * 20);
            lastPositionRef.current = newPos;
          }
          return newPos;
        });
      }, 50);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSeeking]);

  const handlePlayClick = async () => {
    if (isRecording) return;
    if (segmentsRef.current.length === 0 || !audioElementRef.current) {
      return;
    }
    
    if (isPlaying) {
      audioElementRef.current.pause();
      isPlayingRef.current = false;
      setIsPlaying(false);
    } else {
      // Build merged playback blob if needed
      const playbackData = await buildPlaybackBlob();
      if (!playbackData) return;
      
      const audio = audioElementRef.current;
      
      // Set source if different
      if (audio.src !== playbackData.url) {
        audio.src = playbackData.url;
        // Wait for audio to be ready
        await new Promise<void>((resolve) => {
          const onCanPlay = () => {
            audio.removeEventListener('canplay', onCanPlay);
            resolve();
          };
          audio.addEventListener('canplay', onCanPlay);
          if (audio.readyState >= 3) {
            audio.removeEventListener('canplay', onCanPlay);
            resolve();
          }
        });
      }
      
      // Start from beginning if at or near end
      const totalDuration = calculateTotalDuration();
      let startPosition = position;
      
      if (totalDuration > 0 && position >= totalDuration - 0.1) {
        startPosition = 0;
        lastPositionRef.current = 0;
        setPosition(0);
      }
      
      audio.currentTime = startPosition;
      lastPositionRef.current = startPosition;
      
      isPlayingRef.current = true;
      setIsPlaying(true);
      
      try {
        await audio.play();
      } catch (e) {
        console.error('Play failed:', e);
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
    }
  };

  const handleRecordClick = async () => {
    if (isPlaying) return;
    
    if (isRecording) {
      // Stop recording
      isStoppingRecordingRef.current = true;
      
      // Stop the MediaRecorder - this triggers the final 'dataavailable' event
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      // Wait a bit for the final data to be collected
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Stop the media stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      // Process recorded chunks into a new segment
      const chunks = recordedChunksRef.current;
      if (chunks.length > 0) {
        const recordedBlob = new Blob(chunks, { type: chunks[0].type });
        
        // Get duration of the recorded blob
        const tempAudio = new Audio();
        const tempUrl = URL.createObjectURL(recordedBlob);
        tempAudio.src = tempUrl;
        
        await new Promise<void>((resolve) => {
          tempAudio.onloadedmetadata = () => resolve();
          tempAudio.onerror = () => resolve();
        });
        
        const recordedDuration = tempAudio.duration || 0;
        URL.revokeObjectURL(tempUrl);
        
        // Always append new recording at the end
        segmentsRef.current.push({
          blob: recordedBlob,
          duration: recordedDuration,
        });
        
        // Clear recorded chunks
        recordedChunksRef.current = [];
        
        // Invalidate playback blob (will be rebuilt on next play)
        if (playbackBlobRef.current?.url) {
          URL.revokeObjectURL(playbackBlobRef.current.url);
          playbackBlobRef.current = null;
        }
        
        // Update duration
        setDuration(calculateTotalDuration());
      }
      
      // Set isRecording false to stop the timer
      setIsRecording(false);
      isStoppingRecordingRef.current = false;
    } else {
      // Start new recording - always appends at the end
      recordedChunksRef.current = [];
      
      // Set recording start position to end of all existing segments
      const existingDuration = calculateTotalDuration();
      recordingStartPositionRef.current = existingDuration;
      setPosition(existingDuration);
      
      try {
        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          } 
        });
        mediaStreamRef.current = stream;
        
        // Use MediaRecorder for reliable audio capture
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/mp4';
        
        const mediaRecorder = new MediaRecorder(stream, { 
          mimeType,
          audioBitsPerSecond: 128000
        });
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };
        
        mediaRecorder.onerror = (e) => {
          console.error('MediaRecorder error:', e);
        };
        
        // Start recording
        mediaRecorder.start(100);
        
        recordingStartTimeRef.current = Date.now();
        setIsRecording(true);
      } catch (error) {
        console.error('Failed to start recording:', error);
      }
    }
  };

  const handleStopClick = async () => {
    if (isRecording) {
      // Trigger stop by simulating record button click
      await handleRecordClick();
      return;
    }
    if (isPlaying && audioElementRef.current) {
      audioElementRef.current.pause();
      setIsPlaying(false);
      return;
    }
    // Only reset position if nothing was playing/recording
    setPosition(0);
  };

  const handleToggleUp = () => {
    setToggleDirection("up");
    seekDirectionRef.current = "forward";
    setIsSeeking(true);
  };

  const handleToggleDown = () => {
    setToggleDirection("down");
    seekDirectionRef.current = "backward";
    setIsSeeking(true);
  };

  const handleToggleRelease = () => {
    setToggleDirection(null);
    seekDirectionRef.current = null;
    setIsSeeking(false);
  };

  // Handle dropped audio file - adds as segment at current position
  const handleAudioFile = useCallback(async (file: File) => {
    // Stop any current playback or recording
    if (isRecording) {
      // Stop the MediaRecorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      recordedChunksRef.current = [];
      setIsRecording(false);
    }
    if (isPlaying && audioElementRef.current) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    }

    try {
      // Get duration using audio element
      const tempUrl = URL.createObjectURL(file);
      const audio = new Audio();
      audio.src = tempUrl;
      
      await new Promise<void>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve();
        audio.onerror = () => reject(new Error('Failed to load audio file'));
      });
      
      const fileDuration = audio.duration;
      URL.revokeObjectURL(tempUrl);
      
      // Always append file at the end
      segmentsRef.current.push({
        blob: file,
        duration: fileDuration,
      });
      
      // Invalidate playback blob (will be rebuilt on next play)
      if (playbackBlobRef.current?.url) {
        URL.revokeObjectURL(playbackBlobRef.current.url);
        playbackBlobRef.current = null;
      }
      
      // Update duration and move position to end
      const totalDuration = calculateTotalDuration();
      setDuration(totalDuration);
      setPosition(totalDuration);
    } catch (error) {
      console.error('Error processing audio file:', error);
    }
  }, [isRecording, isPlaying, calculateTotalDuration]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    
    if (dragCounterRef.current === 0) {
      setIsDraggingFile(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Extract audio from blob and convert to WAV for transcription (handles video files too)
  // Uses OfflineAudioContext for instant processing (not real-time)
  const extractAudio = useCallback(async (blob: Blob): Promise<Blob> => {
    // Common formats that transcription APIs accept directly
    const directFormats = [
      'audio/webm', 'audio/webm;codecs=opus',
      'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mp3', 'audio/mpeg',
      'audio/ogg', 'audio/flac', 'audio/m4a', 'audio/mp4'
    ];
    
    // If already a supported audio format, return as-is
    if (directFormats.some(f => blob.type.startsWith(f.split(';')[0]))) {
      return blob;
    }
    
    // For video files or unsupported formats, extract and convert to WAV
    // Decode the audio/video to get audio data
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();
    
    // Convert AudioBuffer to WAV blob (instant, no real-time playback needed)
    const wavBlob = audioBufferToWav(audioBuffer);
    return wavBlob;
  }, []);

  // Handle transcription request - transcribe each segment and merge results
  const handleTranscribe = useCallback(async () => {
    if (segmentsRef.current.length === 0 || isTranscribing) return;
    
    setIsTranscribing(true);
    setTranscriptionText(null);
    
    try {
      const config = getConfig();
      const transcriptions: string[] = [];
      
      // Transcribe each segment (extract/convert audio first)
      for (const segment of segmentsRef.current) {
        const audioBlob = await extractAudio(segment.blob);
        const text = await config.client.transcribe("", audioBlob);
        if (text && text.trim()) {
          transcriptions.push(text.trim());
        }
      }
      
      // Merge results
      setTranscriptionText(transcriptions.join(' '));
    } catch (error) {
      console.error('Transcription failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTranscriptionText(`Transcription failed: ${errorMessage}`);
    } finally {
      setIsTranscribing(false);
    }
  }, [isTranscribing, extractAudio]);

  // Handle download request - merge all segments and download as audio file
  const handleDownload = useCallback(async () => {
    if (segmentsRef.current.length === 0) return;
    
    // Build merged playback blob
    const playbackData = await buildPlaybackBlob();
    if (!playbackData) return;
    
    // Create download link
    const a = document.createElement('a');
    a.href = playbackData.url;
    a.download = `recording-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [buildPlaybackBlob]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);

    const files = Array.from(e.dataTransfer.files);
    // Accept both audio and video files
    const mediaFile = files.find(file => 
      file.type.startsWith('audio/') || 
      file.type.startsWith('video/') ||
      file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4|mkv|avi|mov|wmv)$/i)
    );

    if (mediaFile) {
      await handleAudioFile(mediaFile);
    }
  }, [handleAudioFile]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="w-full grow overflow-hidden flex p-4 pt-20">
          <div className="w-full h-full max-w-[1400px] mx-auto">
            <div className="relative h-full w-full overflow-hidden">
              <div className="h-full flex flex-col md:flex-row min-h-0">
                {/* Recorder section */}
                <div className="flex-1 flex items-center justify-center select-none">
                  <div className="relative transform scale-[0.55] sm:scale-[0.65] md:scale-75 lg:scale-90 xl:scale-100">
        {/* Shadow layer - static, behind the device */}
        <div 
          className="absolute bg-black/15 dark:bg-black/30 blur-2xl rounded-3xl"
          style={{ 
            left: '30px', 
            top: '20px', 
            width: '310px', 
            height: '440px',
            transform: 'translate(10px, 15px)',
            zIndex: -1,
          }}
        />
        <svg
          ref={svgRef}
          width="400"
          height="520"
          viewBox="0 0 400 520"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="[--body:#c4c4c4] [--body-alt:#b8b8b8] [--rocker:#b8b8b8] [--rocker-inner:#a0a0a0] [--disc:#b8b8b8] [--disc-inner:#c4c4c4] [--disc-ring:#b8b8b8] [--hub:#b0b0b0] [--hub-inner:#c0c0c0] [--hub-highlight:#d0d0d0] [--line:#aaa] [--text:#666] [--text-light:#999] [--button:#b8b8b8] [--button-active:#a8a8a8] [--icon:#555] dark:[--body:#1a1a1a] dark:[--body-alt:#0d0d0d] dark:[--rocker:#1a1a1a] dark:[--rocker-inner:#0d0d0d] dark:[--disc:#1f1f1f] dark:[--disc-inner:#151515] dark:[--disc-ring:#1a1a1a] dark:[--hub:#0a0a0a] dark:[--hub-inner:#1a1a1a] dark:[--hub-highlight:#333] dark:[--line:#2a2a2a] dark:[--text:#666] dark:[--text-light:#888] dark:[--button:#1f1f1f] dark:[--button-active:#2a2a2a] dark:[--icon:#666]"
          style={{ userSelect: 'none' }}
        >
          {/* Main body */}
          <rect
            x="60"
            y="20"
            width="280"
            height="440"
            rx="16"
            className="fill-(--body)"
          />
          
          {/* Connection arm/bracket to main body (static) */}
          <rect
            x="38"
            y="150"
            width="30"
            height="20"
            rx="3"
            className="fill-(--body)"
          />
          
          {/* Left rail/slider - rotating rocker */}
          <g
            style={{
              transformOrigin: "40px 160px",
              transform: `rotate(${toggleDirection === "up" ? 8 : toggleDirection === "down" ? -8 : 0}deg)`,
              transition: "transform 0.1s ease-out",
              willChange: "transform",
            }}
          >
            {/* Main rocker rail */}
            <rect
              x="30"
              y="60"
              width="20"
              height="200"
              rx="4"
              className="fill-(--rocker)"
            />
            <rect
              x="35"
              y="70"
              width="10"
              height="180"
              rx="2"
              className="fill-(--rocker-inner)"
            />
          </g>
          
          {/* Model name WM-7 */}
          <text
            x="80"
            y="65"
            className="fill-(--text-light)"
            fontSize="18"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="500"
          >
            WM-7
          </text>
          
          {/* Display screen */}
          <rect
            x="270"
            y="40"
            width="65"
            height="35"
            rx="4"
            fill="#0d0d0d"
          />
          <text
            x="277"
            y="55"
            fill={isRecording ? "#ef4444" : isPlaying ? "#4ade80" : "#e0e0e0"}
            fontSize="9"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="600"
          >
            {isRecording ? "REC" : isPlaying ? "PLAY" : "STOP"}
          </text>
          <text
            x="277"
            y="68"
            fill="#888"
            fontSize="9"
            fontFamily="monospace"
          >
            {formatTime(position)}
          </text>
          
          {/* Main disc area - background only */}
          <circle
            cx="200"
            cy="220"
            r="120"
            className="fill-(--disc) stroke-(--disc-ring)"
            strokeWidth="1"
          />
          <circle
            cx="200"
            cy="220"
            r="115"
            className="fill-(--disc-inner)"
          />
          
          {/* Rotating disc group */}
          <g
            style={{
              transformOrigin: "200px 220px",
              transform: (isPlaying || isRecording) ? undefined : `rotate(${discRotation}deg)`,
              animation: (isPlaying || isRecording) ? 'spin 1.5s linear infinite' : undefined,
              willChange: (isPlaying || isRecording || isDraggingDisc) ? 'transform' : undefined,
            }}
          >
            {/* Subtle disc ring */}
            <circle
              cx="200"
              cy="220"
              r="108"
              fill="none"
              className="stroke-(--disc-ring)"
              strokeWidth="0.5"
            />
            
            {/* Disc line - behind hub */}
            <line
              x1="85"
              y1="220"
              x2="315"
              y2="220"
              className="stroke-(--line)"
              strokeWidth="1"
            />
            
            {/* Center hub */}
            <circle
              cx="200"
              cy="220"
              r="28"
              className="fill-(--hub)"
            />
            <circle
              cx="200"
              cy="220"
              r="24"
              className="fill-(--hub-inner)"
            />
          </g>
          
          {/* Bottom control buttons - piano key style, attached at top */}
          <g transform="translate(60, 360)">
            {/* Record button */}
            <g
              onClick={handleRecordClick}
              className="cursor-pointer"
            >
              <rect
                width="60"
                height="100"
                rx="8"
                className={isRecording ? "fill-(--button-active)" : "fill-(--button)"}
              />
              {/* Record circle icon */}
              <circle
                cx="30"
                cy="28"
                r="8"
                fill={isRecording ? "#ef4444" : "var(--icon)"}
              />
            </g>
            
            {/* Play button */}
            <g
              onClick={handlePlayClick}
              className="cursor-pointer"
            >
              <rect
                x="65"
                y="0"
                width="60"
                height="100"
                rx="8"
                className={isPlaying ? "fill-(--button-active)" : "fill-(--button)"}
              />
              <polygon
                points="89,20 89,36 103,28"
                fill={isPlaying ? "#4ade80" : "var(--icon)"}
              />
            </g>
            
            {/* Stop button */}
            <g
              onClick={handleStopClick}
              className="cursor-pointer"
            >
              <rect
                x="130"
                y="0"
                width="60"
                height="100"
                rx="8"
                className="fill-(--button)"
              />
              <rect
                x="150"
                y="20"
                width="14"
                height="14"
                className="fill-(--icon)"
              />
            </g>
            
            {/* Speaker/Transcribe button (right side) */}
            <g 
              transform="translate(195, -10)"
              onClick={handleTranscribe}
              className="cursor-pointer"
              style={{ pointerEvents: 'all' }}
            >
              {/* Background for click area */}
              <rect
                x="0"
                y="10"
                width="75"
                height="55"
                fill="transparent"
              />
              {/* Vertical lines pattern */}
              {[...Array(10)].map((_, i) => (
                <line
                  key={i}
                  x1={10 + i * 6}
                  y1="18"
                  x2={10 + i * 6}
                  y2="55"
                  className={isTranscribing ? "stroke-blue-500" : "stroke-(--text-light) dark:stroke-neutral-600"}
                  strokeWidth="1.5"
                  style={{
                    animation: isTranscribing ? `pulse 0.5s ease-in-out ${i * 0.05}s infinite alternate` : 'none'
                  }}
                />
              ))}
            </g>
            
            {/* Download button (below speaker) */}
            <g 
              transform="translate(195, 45)"
              onClick={handleDownload}
              className="cursor-pointer"
              style={{ pointerEvents: 'all' }}
            >
              {/* Background for click area */}
              <rect
                x="0"
                y="10"
                width="75"
                height="35"
                fill="transparent"
              />
              {/* Horizontal lines pattern */}
              {[...Array(4)].map((_, i) => (
                <line
                  key={i}
                  x1={10}
                  y1={18 + i * 7}
                  x2={65}
                  y2={18 + i * 7}
                  className="stroke-(--text-light) dark:stroke-neutral-600 hover:stroke-(--text)"
                  strokeWidth="1.5"
                />
              ))}
            </g>
          </g>
          

        </svg>
        
        {/* Rocker interaction overlay - placed before disc so it's underneath in stacking but still works */}
        <svg
          width="400"
          height="520"
          viewBox="0 0 400 520"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute top-0 left-0 pointer-events-none"
          style={{ userSelect: 'none', zIndex: 10 }}
        >
          {/* Upper click area (forward/fast-forward) */}
          <rect
            x="30"
            y="60"
            width="20"
            height="100"
            fill="transparent"
            className="cursor-pointer"
            style={{ pointerEvents: 'auto' }}
            onMouseDown={handleToggleUp}
            onMouseUp={handleToggleRelease}
            onMouseLeave={handleToggleRelease}
            onTouchStart={handleToggleUp}
            onTouchEnd={handleToggleRelease}
          />
          {/* Lower click area (backward/rewind) */}
          <rect
            x="30"
            y="160"
            width="20"
            height="100"
            fill="transparent"
            className="cursor-pointer"
            style={{ pointerEvents: 'auto' }}
            onMouseDown={handleToggleDown}
            onMouseUp={handleToggleRelease}
            onMouseLeave={handleToggleRelease}
            onTouchStart={handleToggleDown}
            onTouchEnd={handleToggleRelease}
          />
        </svg>
        
        {/* Disc interaction overlay */}
        <svg
          width="400"
          height="520"
          viewBox="0 0 400 520"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute top-0 left-0 pointer-events-none"
          style={{ userSelect: 'none' }}
        >
          {/* Drop indicator on disc */}
          {isDraggingFile && (
            <circle
              cx="200"
              cy="220"
              r="115"
              fill="rgba(59, 130, 246, 0.3)"
              stroke="rgba(59, 130, 246, 0.8)"
              strokeWidth="3"
              strokeDasharray="10 5"
              className="pointer-events-none"
            />
          )}
          <circle
            cx="200"
            cy="220"
            r="115"
            fill="transparent"
            className="pointer-events-auto cursor-grab"
            style={{ cursor: isDraggingDisc ? 'grabbing' : 'grab' }}
            onMouseDown={(e) => handleDiscStart(e.clientX, e.clientY)}
            onTouchStart={(e) => {
              if (e.touches.length > 0) {
                handleDiscStart(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        </svg>
                  </div>
                </div>

                {/* Transcription section - only show when there's content */}
                {(transcriptionText || isTranscribing) && (
                  <>
                    {/* Divider */}
                    <div className="relative flex items-center justify-center py-2 md:py-0 md:w-8 shrink-0 self-center h-[440px]">
                      <div className="absolute md:inset-y-0 md:w-px md:left-1/2 md:-translate-x-px inset-x-0 h-px md:h-full bg-black/10 dark:bg-white/10"></div>
                    </div>

                    {/* Transcription panel */}
                    <div className="flex-1 flex flex-col relative min-w-0 overflow-hidden self-center h-[440px]">
                      {/* Action buttons */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                        {transcriptionText && (
                          <CopyButton text={transcriptionText} />
                        )}
                        <button
                          onClick={() => setTranscriptionText(null)}
                          className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          title="Clear transcription"
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 overflow-y-auto px-4 py-4 pr-16">
                        {isTranscribing ? (
                          <div className="flex items-center justify-center h-full">
                            <div className="flex items-center gap-2 text-neutral-500">
                              <Loader2 className="animate-spin" size={20} />
                              <span className="text-sm">Transcribing...</span>
                            </div>
                          </div>
                        ) : transcriptionText ? (
                          <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-wrap">
                            {transcriptionText}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      
      {/* Add custom animation keyframes */}
      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes spin-reverse {
          from {
            transform: rotate(360deg);
          }
          to {
            transform: rotate(0deg);
          }
        }
        .animate-spin {
          animation: spin 2s linear infinite;
        }
        .animate-spin-fast {
          animation: spin 0.3s linear infinite;
        }
        .animate-spin-reverse-fast {
          animation: spin-reverse 0.3s linear infinite;
        }
        @keyframes pulse {
          from {
            opacity: 0.4;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
