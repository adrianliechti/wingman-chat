import { getConfig } from "@/shared/config";
import { getModelCapabilities } from "@/shared/lib/modelSelection";
import { useModelCatalog } from "./useModelCatalog";

export function useModelCapabilities() {
  return getModelCapabilities(useModelCatalog(), getConfig());
}
