import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useBackground } from "../hooks/useBackground";

export function BackgroundImage({ opacity = 80 }: { opacity?: number }) {
  const { backgroundImage } = useBackground();

  const backgroundStyles = useMemo(
    (): CSSProperties =>
      backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : {},
    [backgroundImage]
  );

  const backgroundClassName = useMemo(
    () =>
      backgroundImage
        ? `absolute inset-0 bg-cover bg-center bg-no-repeat z-0 transition-opacity duration-700 ease-out opacity-${opacity}`
        : 'absolute inset-0 z-0',
    [backgroundImage, opacity]
  );

  return (
    <div 
      className={backgroundClassName}
      style={backgroundStyles}
    />
  );
}
