import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { CanvasPage } from "./features/canvas/pages/CanvasPage";
import { ChatPage } from "./features/chat/pages/ChatPage";
import { NotebookPage } from "./features/notebook/pages/NotebookPage";
import { OAuthCallbackPage } from "./features/settings/pages/OAuthCallbackPage";
import { TranslatePage } from "./features/translate/pages/TranslatePage";
import { getConfig } from "./shared/config";
import { AppLayout } from "./shell/AppLayout";

const hashToRoute: Record<string, string> = {
  chat: "/chat",
  translate: "/translate",
  canvas: "/canvas",
  research: "/notebook",
  notebook: "/notebook",
};

// Root route — bare outlet, no shell
const rootRoute = createRootRoute({ component: Outlet });

// Pathless layout route — main app shell + hash-to-path redirect for backwards compatibility
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
  beforeLoad: () => {
    const hash = window.location.hash;
    if (hash?.startsWith("#")) {
      const page = hash.slice(1);
      // Only redirect for known legacy hash routes (e.g. #chat, #translate).
      // Hashes that contain "=" are launch params (e.g. #import=...) and must
      // be left intact for useChatLaunch to consume after the page mounts.
      if (page in hashToRoute) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        throw redirect({ to: hashToRoute[page] as "/chat" });
      }
    }
  },
});

// Pathless layout route — bare shell for OAuth popup (no app providers or navigation)
const oauthLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "oauth",
  component: Outlet,
});

// Index route — redirect / to /chat
const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/chat" });
  },
});

// Chat routes
const chatRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/chat",
  component: ChatPage,
});

const chatIdRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/chat/$chatId",
  component: ChatPage,
});

const translateRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/translate",
  beforeLoad: () => {
    if (!getConfig().translator) throw redirect({ to: "/chat" });
  },
  component: TranslatePage,
});

const canvasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/canvas",
  beforeLoad: () => {
    if (!getConfig().renderer) throw redirect({ to: "/chat" });
  },
  component: CanvasPage,
});

const notebookRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/notebook",
  beforeLoad: () => {
    if (!getConfig().notebook) throw redirect({ to: "/chat" });
  },
  component: NotebookPage,
});

// Child route — provides the :notebookId param without remounting the parent.
const notebookIdRoute = createRoute({
  getParentRoute: () => notebookRoute,
  path: "$notebookId",
  component: () => null,
});

// OAuth callback route — rendered under bare layout (no app shell)
const oauthCallbackRoute = createRoute({
  getParentRoute: () => oauthLayoutRoute,
  path: "/oauth/callback",
  component: OAuthCallbackPage,
});

// Build route tree
const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    chatRoute,
    chatIdRoute,
    translateRoute,
    canvasRoute,
    notebookRoute.addChildren([notebookIdRoute]),
  ]),
  oauthLayoutRoute.addChildren([oauthCallbackRoute]),
]);

// Create and export router
export const router = createRouter({ routeTree });

// Register router type for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
