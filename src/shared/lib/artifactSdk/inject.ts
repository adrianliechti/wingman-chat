import { SDK_PATH, type SdkCapabilities } from "./protocol";

export interface InjectSdkOptions {
  token: string;
  /** The page's artifact path, e.g. `/dashboard.html`. */
  path: string;
  capabilities: SdkCapabilities;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** URL of the SDK script inside a preview session. */
export function sdkScriptUrl(token: string): string {
  return `/__preview__/${encodeURIComponent(token)}/${SDK_PATH}`;
}

/**
 * Insert the SDK script tag at the top of an HTML document so `window.wingman`
 * exists before the page's own scripts run. The stored artifact is never
 * changed; only the copy served to the preview carries the tag.
 */
export function injectSdkScript(html: string, options: InjectSdkOptions): string {
  const tag =
    `<script src="${sdkScriptUrl(options.token)}"` +
    ` data-token="${escapeAttribute(options.token)}"` +
    ` data-path="${escapeAttribute(options.path)}"` +
    ` data-capabilities="${escapeAttribute(JSON.stringify(options.capabilities))}"></script>`;
  if (html.includes(sdkScriptUrl(options.token))) return html;

  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  }
  return `${tag}${html}`;
}
