import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { getConfig } from './shared/config';
import { ChatPage } from './features/chat/pages/ChatPage';
import { WorkflowPage } from './features/workflow/pages/WorkflowPage';
import { TranslatePage } from './features/translate/pages/TranslatePage';
import { RendererPage } from './features/renderer/pages/RendererPage';
import { ResearchPage } from './features/research/pages/ResearchPage';

const hashToRoute: Record<string, string> = {
  chat: '/chat',
  flow: '/flow',
  translate: '/translate',
  renderer: '/renderer',
  research: '/research',
};

// Root route — handles hash-to-path redirect for backwards compatibility
export const rootRoute = createRootRoute({
  beforeLoad: () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#')) {
      const page = hash.slice(1);
      const to = hashToRoute[page] ?? '/chat';
      history.replaceState(null, '', window.location.pathname + window.location.search);
      throw redirect({ to: to as '/chat' });
    }
  },
});

// Index route — redirect / to /chat
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chat' });
  },
});

// Chat routes
export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatPage,
});

export const chatIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$chatId',
  component: ChatPage,
});

// Feature routes with config guards
const flowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/flow',
  beforeLoad: () => {
    if (!getConfig().workflow) throw redirect({ to: '/chat' });
  },
  component: WorkflowPage,
});

const translateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/translate',
  beforeLoad: () => {
    if (!getConfig().translator) throw redirect({ to: '/chat' });
  },
  component: TranslatePage,
});

const rendererRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/renderer',
  beforeLoad: () => {
    if (!getConfig().renderer) throw redirect({ to: '/chat' });
  },
  component: RendererPage,
});

const researchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/research',
  beforeLoad: () => {
    if (!getConfig().researcher) throw redirect({ to: '/chat' });
  },
  component: ResearchPage,
});

// Build route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  chatIdRoute,
  flowRoute,
  translateRoute,
  rendererRoute,
  researchRoute,
]);

// Create and export router
export const router = createRouter({ routeTree });

// Register router type for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
