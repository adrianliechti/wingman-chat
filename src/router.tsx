import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { getConfig } from './shared/config';
import { AppLayout } from './shell/AppLayout';
import { ChatPage } from './features/chat/pages/ChatPage';
import { WorkflowPage } from './features/workflow/pages/WorkflowPage';
import { TranslatePage } from './features/translate/pages/TranslatePage';
import { RendererPage } from './features/renderer/pages/RendererPage';
import { NotebookPage } from './features/notebook/pages/NotebookPage';
import { OAuthCallbackPage } from './features/settings/pages/OAuthCallbackPage';

const hashToRoute: Record<string, string> = {
  chat: '/chat',
  flow: '/flow',
  translate: '/translate',
  renderer: '/renderer',
  research: '/notebook',
  notebook: '/notebook',
};

// Root route — bare outlet, no shell
const rootRoute = createRootRoute({ component: Outlet });

// Pathless layout route — main app shell + hash-to-path redirect for backwards compatibility
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
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

// Pathless layout route — bare shell for OAuth popup (no app providers or navigation)
const oauthLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'oauth',
  component: Outlet,
});

// Index route — redirect / to /chat
const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chat' });
  },
});

// Chat routes
const chatRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/chat',
  component: ChatPage,
});

const chatIdRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/chat/$chatId',
  component: ChatPage,
});

// Feature routes with config guards
const flowRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/flow',
  beforeLoad: () => {
    if (!getConfig().workflow) throw redirect({ to: '/chat' });
  },
  component: WorkflowPage,
});

const translateRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/translate',
  beforeLoad: () => {
    if (!getConfig().translator) throw redirect({ to: '/chat' });
  },
  component: TranslatePage,
});

const rendererRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/renderer',
  beforeLoad: () => {
    if (!getConfig().renderer) throw redirect({ to: '/chat' });
  },
  component: RendererPage,
});

const notebookRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/notebook',
  beforeLoad: () => {
    if (!getConfig().notebook) throw redirect({ to: '/chat' });
  },
  component: NotebookPage,
});

const notebookIdRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/notebook/$notebookId',
  beforeLoad: () => {
    if (!getConfig().notebook) throw redirect({ to: '/chat' });
  },
  component: NotebookPage,
});

// OAuth callback route — rendered under bare layout (no app shell)
const oauthCallbackRoute = createRoute({
  getParentRoute: () => oauthLayoutRoute,
  path: '/oauth/callback',
  component: OAuthCallbackPage,
});

// Build route tree
const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    chatRoute,
    chatIdRoute,
    flowRoute,
    translateRoute,
    rendererRoute,
    notebookRoute,
    notebookIdRoute,
  ]),
  oauthLayoutRoute.addChildren([oauthCallbackRoute]),
]);

// Create and export router
export const router = createRouter({ routeTree });

// Register router type for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
