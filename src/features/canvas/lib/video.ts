/** Read dimensions and capture a small poster without retaining an object URL. */
export function videoMetadata(blob: Blob): Promise<{
  data: string;
  width: number;
  height: number;
  duration: number;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const fail = () => {
      cleanup();
      reject(new Error("The generated video could not be decoded"));
    };
    const timer = setTimeout(fail, 30_000);
    video.onloadeddata = () => {
      const { videoWidth: width, videoHeight: height, duration } = video;
      if (!width || !height || !Number.isFinite(duration)) return fail();
      let data = "";
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 512 / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          data = canvas.toDataURL("image/jpeg", 0.8);
        }
      } catch {
        // Playback and saving still work when the browser cannot capture a poster.
      }
      cleanup();
      resolve({ data, width, height, duration });
    };
    video.onerror = fail;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
  });
}
