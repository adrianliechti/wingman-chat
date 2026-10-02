import { createContext } from "react";

/**
 * Where floating layers (menus, tooltips, popovers) mount. Null means the main
 * document's body; a Picture-in-Picture window provides its own body so its
 * menus open inside it rather than in the opener tab.
 */
export const PortalRootContext = createContext<HTMLElement | null>(null);
