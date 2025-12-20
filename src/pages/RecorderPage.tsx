import { useState, useEffect, useRef, useCallback } from "react";
import { getConfig } from "../config";
import { CopyButton } from "../components/CopyButton";
import { Loader2, XIcon } from "lucide-react";
import { AudioRecorder, type AudioChunk } from "../lib/AudioRecorder";
import { AudioPlayer } from "../lib/AudioPlayer";
import { pcm16ToWav, mergePcm16Chunks, pcm16Duration, audioBufferToWav } from "../lib/audio";

export function RecorderPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [toggleDirection, setToggleDirection] = useState<"up" | "down" | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const seekDirectionRef = useRef<"forward" | "backward" | null>(null);
  
  // Audio refs
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isStoppingRecordingRef = useRef(false);
  
  // Recording state
  const recordingStartPositionRef = useRef<number>(0);
  const isPlayingRef = useRef(false); // Ref to check playing state in async callbacks
  const lastPositionRef = useRef<number>(0); // Track last position for smooth disc rotation
  
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
    if (isPlaying && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
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
    if (isPlaying && audioPlayerRef.current) {
      audioPlayerRef.current.seek(position);
      audioPlayerRef.current.play();
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

  // Initialize AudioPlayer for playback (only once)
  useEffect(() => {
    const player = new AudioPlayer({
      onTimeUpdate: (currentTime) => {
        if (isPlayingRef.current) {
          // Update disc rotation based on position change
          const delta = currentTime - lastPositionRef.current;
          if (Math.abs(delta) < 1) { // Only smooth updates, not jumps
            setDiscRotation(prev => prev + delta * 360); // 1 second = 360 degrees
          }
          lastPositionRef.current = currentTime;
          setPosition(currentTime);
        }
      },
      onEnded: () => {
        isPlayingRef.current = false;
        setIsPlaying(false);
        // Set position to end
        setPosition(durationRef.current);
        lastPositionRef.current = durationRef.current;
      },
    });
    audioPlayerRef.current = player;
    
    return () => {
      player.dispose();
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
    const player = audioPlayerRef.current;
    if (!player || player.getTotalDuration() === 0) return;
    
    if (isPlaying) {
      player.pause();
      isPlayingRef.current = false;
      setIsPlaying(false);
    } else {
      // Build merged playback if needed
      await player.buildPlayback();
      
      // Start from beginning if at or near end
      const totalDuration = player.getTotalDuration();
      let startPosition = position;
      
      if (totalDuration > 0 && position >= totalDuration - 0.1) {
        startPosition = 0;
        lastPositionRef.current = 0;
        setPosition(0);
      }
      
      player.seek(startPosition);
      lastPositionRef.current = startPosition;
      
      isPlayingRef.current = true;
      setIsPlaying(true);
      
      try {
        await player.play();
      } catch (e) {
        console.error('Play failed:', e);
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
    }
  };

  const handleRecordClick = async () => {
    if (isPlaying) return;
    const player = audioPlayerRef.current;
    
    if (isRecording) {
      // Stop recording
      isStoppingRecordingRef.current = true;
      
      // Stop the AudioRecorder
      if (audioRecorderRef.current) {
        await audioRecorderRef.current.end();
        audioRecorderRef.current = null;
      }
      
      // Process recorded PCM chunks into a new segment
      const chunks = pcmChunksRef.current;
      if (chunks.length > 0 && player) {
        const sampleRate = 24000;
        const merged = mergePcm16Chunks(chunks);
        const recordedBlob = pcm16ToWav(merged, sampleRate);
        const recordedDuration = pcm16Duration(merged.length, sampleRate);
        
        // Add segment to AudioPlayer
        player.addSegment({ blob: recordedBlob, duration: recordedDuration });
        
        // Clear recorded chunks
        pcmChunksRef.current = [];
        
        // Update duration
        setDuration(player.getTotalDuration());
      }
      
      // Set isRecording false to stop the timer
      setIsRecording(false);
      isStoppingRecordingRef.current = false;
    } else {
      // Start new recording - always appends at the end
      pcmChunksRef.current = [];
      
      // Set recording start position to end of all existing segments
      const existingDuration = player?.getTotalDuration() ?? 0;
      recordingStartPositionRef.current = existingDuration;
      setPosition(existingDuration);
      
      try {
        // Create and initialize AudioRecorder
        const recorder = new AudioRecorder({ sampleRate: 24000 });
        await recorder.begin();
        
        // Start recording with chunk callback
        await recorder.record((chunk: AudioChunk) => {
          pcmChunksRef.current.push(new Int16Array(chunk.mono));
        });
        
        audioRecorderRef.current = recorder;
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
    if (isPlaying && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      isPlayingRef.current = false;
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
    const player = audioPlayerRef.current;
    if (!player) return;
    
    // Stop any current playback or recording
    if (isRecording) {
      // Stop the AudioRecorder
      if (audioRecorderRef.current) {
        await audioRecorderRef.current.end();
        audioRecorderRef.current = null;
      }
      pcmChunksRef.current = [];
      setIsRecording(false);
    }
    if (isPlaying) {
      player.pause();
      isPlayingRef.current = false;
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
      
      // Add segment to AudioPlayer
      player.addSegment({ blob: file, duration: fileDuration });
      
      // Update duration and move position to end
      const totalDuration = player.getTotalDuration();
      setDuration(totalDuration);
      setPosition(totalDuration);
    } catch (error) {
      console.error('Error processing audio file:', error);
    }
  }, [isRecording, isPlaying]);

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
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();
    
    return audioBufferToWav(audioBuffer);
  }, []);

  // Handle transcription request - transcribe each segment and merge results
  const handleTranscribe = useCallback(async () => {
    const player = audioPlayerRef.current;
    const segments = player?.getSegments() ?? [];
    if (segments.length === 0 || isTranscribing) return;
    
    setIsTranscribing(true);
    setTranscriptionText(null);
    
    try {
      const config = getConfig();
      const transcriptions: string[] = [];
      
      // Transcribe each segment (extract/convert audio first)
      for (const segment of segments) {
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
    const player = audioPlayerRef.current;
    if (!player || player.getTotalDuration() === 0) return;
    
    // Get merged blob from AudioPlayer
    const blob = await player.getMergedBlob();
    if (!blob) return;
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

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
        <div className="w-full grow overflow-y-auto overflow-x-hidden flex p-4 pt-20">
          <div className="w-full h-full max-w-350 mx-auto">
            <div className="relative h-full w-full md:overflow-hidden">
              <div className="h-full flex flex-col md:flex-row md:min-h-0">
                {/* Recorder section */}
                <div className={`${(transcriptionText || isTranscribing) ? 'h-1/2 md:h-full md:flex-1' : 'flex-1'} flex items-center justify-center select-none py-4 md:py-0`}>
                  <div className={`relative transform ${(transcriptionText || isTranscribing) ? 'scale-[0.65] sm:scale-[0.7]' : 'scale-100 sm:scale-100'} md:scale-75 lg:scale-90 xl:scale-100`}>
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
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
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
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
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
            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
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
            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
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
                    <div className="relative flex items-center justify-center py-2 md:py-0 md:w-8 shrink-0">
                      <div className="absolute md:inset-y-0 md:w-px md:left-1/2 md:-translate-x-px inset-x-0 h-px md:h-full bg-black/10 dark:bg-white/10"></div>
                    </div>

                    {/* Transcription panel */}
                    <div className="h-1/2 md:h-full md:flex-1 flex flex-col relative min-w-0 overflow-hidden">
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
