export const canShare = (title?: string, text?: string, url?: string): boolean => {
  if (!navigator.share) {
    return false;
  }
  
  if (!navigator.canShare) {
    return true; // If canShare is not available, assume share is supported
  }
  
  const shareData = {
    title: title,
    text: text,
    url: url
  };

  // Remove undefined values
  Object.keys(shareData).forEach(key => {
    if (shareData[key as keyof typeof shareData] === undefined) {
      delete shareData[key as keyof typeof shareData];
    }
  });

  return navigator.canShare(shareData);
};

export const share = async (title?: string, text?: string, url?: string): Promise<boolean> => {
  const shareData = {
    title: title || "Shared Message",
    text: text?.replace(/'/g, "'"), // Clean up smart quotes
    url: url
  };

  // Remove undefined values
  Object.keys(shareData).forEach(key => {
    if (shareData[key as keyof typeof shareData] === undefined) {
      delete shareData[key as keyof typeof shareData];
    }
  });

  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return true;
    } catch (error) {
      console.log("Web Share cancelled or failed:", error);
      return false;
    }
  }
  return false;
};
