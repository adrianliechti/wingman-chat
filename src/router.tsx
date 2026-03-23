import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { getConfig } from './shared/config';
import { AppLayout } from './shell/AppLayout';
import { ChatPage } from './features/chat/pages/ChatPage';
import { WorkflowPage } from './features/workflow/pages/WorkflowPage';
import { TranslatePage } from './features/translate/pages/TranslatePage';
import { RendererPage } from './features/renderer/pages/RendererPage';
import { NotebookPage } from './features/notebook/pages/NotebookPage';

const hashToRoute: Record<string, string> = {
  chat: '/chat',
  flow: '/flow',
  translate: '/translate',
  renderer: '/renderer',
  research: '/notebook',
  notebook: '/notebook',
};

// Root route — layout shell + hash-to-path redirect for backwards compatibility
const rootRoute = createRootRoute({
  component: AppLayout,
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
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatPage,
});

const chatIdRoute = createRoute({
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

const notebookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notebook',
  beforeLoad: () => {
    if (!getConfig().notebook) throw redirect({ to: '/chat' });
  },
  component: NotebookPage,
});

const notebookIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notebook/$notebookId',
  beforeLoad: () => {
    if (!getConfig().notebook) throw redirect({ to: '/chat' });
  },
  component: NotebookPage,
});

// Build route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  chatIdRoute,
  flowRoute,
  translateRoute,
  rendererRoute,
  notebookRoute,
  notebookIdRoute,
]);

// Create and export router
export const router = createRouter({ routeTree });

// Register router type for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
