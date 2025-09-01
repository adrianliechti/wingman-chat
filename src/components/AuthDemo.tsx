import React, { useEffect, useState, useCallback } from 'react';
import { createAuth } from '../lib/auth';
import type { User } from 'oidc-client-ts';

interface AuthDemoProps {
  authority: string;
  clientId: string;
}

export const AuthDemo: React.FC<AuthDemoProps> = ({ authority, clientId }) => {
  const [auth] = useState(() => createAuth({ authority, clientId }));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  const checkAuthStatus = useCallback(async () => {
    try {
      const authenticated = await auth.isAuthenticated();
      setIsAuthenticated(authenticated);
      
      if (authenticated) {
        const currentUser = await auth.getUser();
        setUser(currentUser);
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
    }
  }, [auth]);

  useEffect(() => {
    // Check initial authentication status
    checkAuthStatus();
  }, [checkAuthStatus]);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const user = await auth.loginPopup();
      if (user) {
        setIsAuthenticated(true);
        setUser(user);
        console.log('Login successful! Check console for tokens.');
      }
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await auth.removeUser();
      setIsAuthenticated(false);
      setUser(null);
      console.log('Logged out successfully');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const showTokens = async () => {
    try {
      const accessToken = await auth.getAccessToken();
      const idToken = await auth.getIdToken();
      
      console.log('=== Current Tokens ===');
      console.log('Access Token:', accessToken);
      console.log('ID Token:', idToken);
      console.log('User Info:', user);
    } catch (error) {
      console.error('Error getting tokens:', error);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">OIDC Authentication Demo</h2>
      
      <div className="mb-4">
        <p className="text-sm text-gray-600">Authority: {authority}</p>
        <p className="text-sm text-gray-600">Client ID: {clientId}</p>
      </div>

      <div className="mb-4">
        <p className="font-semibold">
          Status: {isAuthenticated ? '✅ Authenticated' : '❌ Not Authenticated'}
        </p>
        {user && (
          <p className="text-sm text-gray-600">
            User: {user.profile?.name || user.profile?.email || 'Unknown'}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {!isAuthenticated ? (
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login with Popup'}
          </button>
        ) : (
          <>
            <button
              onClick={showTokens}
              className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Show Tokens in Console
            </button>
            <button
              onClick={handleLogout}
              disabled={loading}
              className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
            >
              {loading ? 'Logging out...' : 'Logout'}
            </button>
          </>
        )}
      </div>

      <div className="mt-4 p-3 bg-gray-100 rounded">
        <p className="text-xs text-gray-600">
          💡 Open browser console to see token logs and authentication events
        </p>
      </div>
    </div>
  );
};

export default AuthDemo;
