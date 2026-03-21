import {
  createRouter,
  createRootRoute,
  createRoute,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./AppLayout.tsx";
import { ChatPage } from "./features/chat/pages/ChatPage";
import { WorkflowPage } from "./features/workflow/pages/WorkflowPage";
import { TranslatePage } from "./features/translate/pages/TranslatePage";
import { RendererPage } from "./features/renderer/pages/RendererPage";
import { ResearchPage } from "./features/research/pages/ResearchPage";
import {
  chatRoutePath,
  chatRouteTo,
  flowRoutePath,
  translateRoutePath,
  rendererRoutePath,
  researchRoutePath,
} from "./routeTargets";
import { getConfig } from "./shared/config";

// Root route — renders the app shell layout
const rootRoute = createRootRoute({
  component: AppLayout,
  notFoundComponent: () => (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-800 dark:text-neutral-200">404</h1>
        <p className="text-neutral-600 dark:text-neutral-400 mt-2">Page not found</p>
      </div>
    </div>
  ),
});

function redirectToChat() {
  throw redirect({ to: chatRouteTo, params: { chatId: undefined } });
}

function requireFeature(enabled: boolean) {
  if (!enabled) {
    redirectToChat();
  }
}

// /chat and /chat/:chatId — defined first so other routes can reference chatRoute.to
export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: chatRoutePath,
  component: ChatPage,
});

// Index route — redirect / to /chat
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    redirectToChat();
  },
});

// /flow
export const flowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: flowRoutePath,
  beforeLoad: () => {
    requireFeature(!!getConfig().workflow);
  },
  component: WorkflowPage,
});

// /translate
export const translateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: translateRoutePath,
  beforeLoad: () => {
    requireFeature(!!getConfig().translator);
  },
  component: TranslatePage,
});

// /renderer
export const rendererRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: rendererRoutePath,
  beforeLoad: () => {
    requireFeature(!!getConfig().renderer);
  },
  component: RendererPage,
});

// /research
export const researchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: researchRoutePath,
  beforeLoad: () => {
    requireFeature(!!getConfig().researcher);
  },
  component: ResearchPage,
});

// Build the route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  flowRoute,
  translateRoute,
  rendererRoute,
  researchRoute,
]);

// Create the router instance
export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// Register the router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
