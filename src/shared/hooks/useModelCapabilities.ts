import { getModelCapabilities } from "@/shared/lib/modelSelection";
import { useModelCatalog } from "./useModelCatalog";

/** Features supported by the live backend model inventory. */
export function useModelCapabilities() {
  return getModelCapabilities(useModelCatalog());
}
