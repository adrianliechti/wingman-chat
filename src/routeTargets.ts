export type Page = "chat" | "flow" | "translate" | "renderer" | "research";

export const chatRoutePath = "chat/{-$chatId}" as const;
export const chatRouteTo = "/chat/{-$chatId}" as const;
export const flowRoutePath = "flow" as const;
export const flowRouteTo = "/flow" as const;
export const translateRoutePath = "translate" as const;
export const translateRouteTo = "/translate" as const;
export const rendererRoutePath = "renderer" as const;
export const rendererRouteTo = "/renderer" as const;
export const researchRoutePath = "research" as const;
export const researchRouteTo = "/research" as const;

export const pageRouteTargets = {
  chat: { to: chatRouteTo, params: { chatId: undefined as string | undefined } },
  flow: { to: flowRouteTo },
  translate: { to: translateRouteTo },
  renderer: { to: rendererRouteTo },
  research: { to: researchRouteTo },
} as const;

export function getPageFromPath(pathname: string): Page {
  if (pathname.startsWith(flowRouteTo)) return "flow";
  if (pathname.startsWith(translateRouteTo)) return "translate";
  if (pathname.startsWith(rendererRouteTo)) return "renderer";
  if (pathname.startsWith(researchRouteTo)) return "research";
  return "chat";
}