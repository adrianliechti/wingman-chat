import { useContext } from "react";
import { ImageGenerationContext } from "../contexts/ImageGenerationContext";

export function useImageGeneration() {
  const context = useContext(ImageGenerationContext);
  if (!context) {
    throw new Error("useImageGeneration must be used within an ImageGenerationProvider");
  }
  return context;
}
