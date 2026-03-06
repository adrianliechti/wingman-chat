import { memo } from 'react';

interface MediaPlayerProps {
  url: string;
  type: 'audio' | 'video';
  children?: React.ReactNode;
}

const MediaPlayer = memo(({ url, type, children }: MediaPlayerProps) => {
  // For direct audio files
  if (url.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i) && type === 'audio') {
    return (
      <div className="my-4">
        <audio 
          controls 
          className="w-full max-w-md"
          preload="metadata"
        >
          <source src={url} />
          Your browser does not support the audio element.
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
            {children || url}
          </a>
        </audio>
        {children && (
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {children}
          </div>
        )}
      </div>
    );
  }

  // For direct video files
  if (url.match(/\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv)$/i) && type === 'video') {
    return (
      <div className="my-4">
        <video 
          controls 
          className="w-full max-w-2xl rounded-lg"
          preload="metadata"
        >
          <source src={url} />
          Your browser does not support the video element.
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
            {children || url}
          </a>
        </video>
        {children && (
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {children}
          </div>
        )}
      </div>
    );
  }

  // Fallback to regular link for non-direct media files
  return (
    <a
      className="text-blue-500 hover:underline"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  );
});

MediaPlayer.displayName = 'MediaPlayer';

export { MediaPlayer };
