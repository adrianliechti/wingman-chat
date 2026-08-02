import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { ChatPage } from "./features/chat/pages/ChatPage";
import { getConfig } from "./shared/config";
import { AppLayout } from "./shell/AppLayout";

// ChatPage is the default landing route, so it stays in the initial bundle.
// The other active pages are loaded on demand. Legacy Notebook data is only
// imported when an old deep link is opened.
const CanvasPage = lazyRouteComponent(() => import("./features/canvas/pages/CanvasPage"), "CanvasPage");
const TranslatePage = lazyRouteComponent(() => import("./features/translate/pages/TranslatePage"), "TranslatePage");
const OAuthCallbackPage = lazyRouteComponent(
  () => import("./features/settings/pages/OAuthCallbackPage"),
  "OAuthCallbackPage",
);

const hashToRoute: Record<string, string> = {
  chat: "/chat",
  translate: "/translate",
  canvas: "/canvas",
  research: "/chat",
  notebook: "/chat",
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
      const to = hashToRoute[page] ?? "/chat";
      history.replaceState(null, "", window.location.pathname + window.location.search);
      throw redirect({ to: to as "/chat" });
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
    throw redirect({ to: "/chat" });
  },
});

const notebookIdRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/notebook/$notebookId",
  beforeLoad: async ({ params }) => {
    const { convertNotebookToChat } = await import("./features/notebook/lib/convertNotebookToChat");
    let chatId: string;
    try {
      chatId = await convertNotebookToChat(params.notebookId);
    } catch (error) {
      console.error("Notebook conversion failed", error);
      throw redirect({ to: "/chat" });
    }
    throw redirect({ to: "/chat/$chatId", params: { chatId } });
  },
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
    notebookRoute,
    notebookIdRoute,
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
