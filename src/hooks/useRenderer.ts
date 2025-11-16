import { useContext } from "react";
import { RendererContext } from "../contexts/RendererContext";

export function useRenderer() {
  const context = useContext(RendererContext);
  if (!context) {
    throw new Error("useRenderer must be used within a RendererProvider");
  }
  return context;
}
