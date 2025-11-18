import { useEffect } from 'react';

export function OAuthCallbackPage() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (window.opener) {
      // Add a 1.5 second delay so users can see the authentication is working
      setTimeout(() => {
        // Generate a fake token for testing (similar to Go implementation)
        const token = code ? `mcp_token_${generateRandomState()}` : '';
        
        window.opener.postMessage(
          {
            type: 'oauth_callback',
            token: token,
            error: error || (code ? '' : 'authorization_failed'),
          },
          window.location.origin
        );
        
        // Close the popup after sending the message
        window.close();
      }, 1500);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="text-center p-8">
        <h1 className="text-2xl font-semibold mb-4 text-neutral-900 dark:text-neutral-100">
          Processing Authentication...
        </h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          You can close this window if it doesn't close automatically.
        </p>
      </div>
    </div>
  );
}

function generateRandomState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export default OAuthCallbackPage;
