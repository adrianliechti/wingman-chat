import { memo } from "react";

const mediaLinkClassName =
  "text-sky-700 dark:text-sky-300 underline decoration-2 underline-offset-3 decoration-sky-500/60 dark:decoration-sky-400/70 hover:text-sky-800 dark:hover:text-sky-200 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50";

interface MediaPlayerProps {
  url: string;
  type: "audio" | "video";
  children?: React.ReactNode;
}

const MediaPlayer = memo(({ url, type, children }: MediaPlayerProps) => {
  // For direct audio files
  if (url.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i) && type === "audio") {
    return (
      <div className="my-4">
        <audio controls className="w-full max-w-md" preload="metadata">
          <source src={url} />
          Your browser does not support the audio element.
          <a href={url} target="_blank" rel="noopener noreferrer" className={mediaLinkClassName}>
            {children || url}
          </a>
        </audio>
        {children && <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{children}</div>}
      </div>
    );
  }

  // For direct video files
  if (url.match(/\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv)$/i) && type === "video") {
    return (
      <div className="my-4">
        <video controls className="w-full max-w-2xl rounded-lg" preload="metadata">
          <source src={url} />
          Your browser does not support the video element.
          <a href={url} target="_blank" rel="noopener noreferrer" className={mediaLinkClassName}>
            {children || url}
          </a>
        </video>
        {children && <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{children}</div>}
      </div>
    );
  }

  // Fallback to regular link for non-direct media files
  return (
    <a className={mediaLinkClassName} href={url} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
});

MediaPlayer.displayName = "MediaPlayer";

export { MediaPlayer };
