import { FloatingPortal as BaseFloatingPortal } from "@floating-ui/react";
import { use, type ReactNode } from "react";
import { PortalRootContext } from "./PortalRootContext";

/** Floating UI's portal, mounted into the nearest `PortalRootContext` root. */
export function FloatingPortal({ children }: { children: ReactNode }) {
  const root = use(PortalRootContext);
  return <BaseFloatingPortal root={root ?? undefined}>{children}</BaseFloatingPortal>;
}
