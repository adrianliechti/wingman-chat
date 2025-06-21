import { useEffect, useState } from "react";
import { useVoice } from "../hooks/useVoice";

export function VoiceWaves() {
  const { isListening } = useVoice();
  const [waveOffset, setWaveOffset] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1200);

  // Update viewport width on resize
  useEffect(() => {
    const updateWidth = () => {
      setViewportWidth(window.innerWidth);
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setWaveOffset(prev => (prev + 5) % 360); // Animate wave movement
    }, 50);

    return () => clearInterval(interval);
  }, []);

  // Generate wave path
  const generateWavePath = (offset = 0, amplitude = 1, frequency = 0.02) => {
    const width = viewportWidth;
    const height = 120;
    const centerY = height / 2;
    const baseAmplitude = isListening ? 15 : 8;
    const finalAmplitude = baseAmplitude * amplitude + Math.sin((waveOffset + offset) * 0.08) * 5;
    
    let path = `M 0 ${centerY}`;
    
    for (let x = 0; x <= width; x += 4) {
      const y = centerY + Math.sin((x * frequency) + ((waveOffset + offset) * 0.1)) * finalAmplitude;
      path += ` L ${x} ${y}`;
    }
    
    return path;
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {isListening && (
        <svg 
          width="100%" 
          height="100%" 
          viewBox={`0 0 ${viewportWidth} 120`}
          className="w-full h-full"
          preserveAspectRatio="none"
        >
          {/* Wave line 1 - Main */}
          <path
            d={generateWavePath(0, 1.0, 0.015)}
            stroke="rgb(156 163 175)" // gray-400
            strokeWidth="2"
            fill="none"
            className="dark:stroke-gray-500"
            style={{
              opacity: 0.8,
              filter: 'drop-shadow(0 1px 4px rgba(0, 0, 0, 0.1)) drop-shadow(0 0 12px rgba(156, 163, 175, 0.2))',
            }}
          />
          
          {/* Wave line 2 - Secondary */}
          <path
            d={generateWavePath(80, 0.7, 0.018)}
            stroke="rgb(209 213 219)" // gray-300
            strokeWidth="1.5"
            fill="none"
            className="dark:stroke-gray-600"
            style={{
              opacity: 0.6,
              filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.08)) drop-shadow(0 0 10px rgba(209, 213, 219, 0.15))',
              transform: 'translateY(-8px)',
            }}
          />
          
          {/* Wave line 3 - Tertiary */}
          <path
            d={generateWavePath(160, 0.5, 0.022)}
            stroke="rgb(107 114 128)" // gray-500
            strokeWidth="1"
            fill="none"
            className="dark:stroke-gray-400"
            style={{
              opacity: 0.5,
              filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.06)) drop-shadow(0 0 8px rgba(107, 114, 128, 0.15))',
              transform: 'translateY(8px)',
            }}
          />
        </svg>
      )}
    </div>
  );
}
