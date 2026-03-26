import { useEffect, useMemo } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

/**
* Handles the OAuth redirect callback at /oauth/callback.
*
* Extracts the authorization code (or error) from the URL search params,
* posts it back to the opener via postMessage, then closes the popup.
*/
export function OAuthCallbackPage() {
  const { status, errorMessage, code } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    if (code) {
      return { status: 'success' as const, errorMessage: '', code };
    } else {
      const msg = errorDescription ?? error ?? 'Authorization failed';
      return { status: 'error' as const, errorMessage: msg, code: null };
    }
  }, []);

  useEffect(() => {
    if (window.opener) {
      if (code) {
        window.opener.postMessage({ type: 'mcp_oauth_callback', code }, window.location.origin);
        setTimeout(() => window.close(), 2000);
      } else {
        window.opener.postMessage({ type: 'mcp_oauth_callback', error: errorMessage }, window.location.origin);
        setTimeout(() => window.close(), 3000);
      }
    } else if (code) {
      // Opened as a full-page redirect (popup blocker fallback)
      // Store the code in localStorage so the app can pick it up
      localStorage.setItem('mcp_oauth_redirect_code', code);
    }
  }, [code, errorMessage]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="max-w-sm space-y-3 rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
        {status === 'success' && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400">
              <CheckCircle className="h-6 w-6" />
            </div>
            <h2 className="font-semibold">Authorization successful</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">You can close this window.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">
              <XCircle className="h-6 w-6" />
            </div>
            <h2 className="font-semibold">Authorization failed</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{errorMessage}</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-600">This window will close automatically.</p>
          </>
        )}
      </div>
    </div>
  );
}
