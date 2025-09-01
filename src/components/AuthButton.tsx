import React, { useState, useEffect } from 'react';
import { LogIn, LogOut, User } from 'lucide-react';
import { Button } from '@headlessui/react';
import { createAuth } from '../lib/auth';
import type { User as OidcUser } from 'oidc-client-ts';

const auth = createAuth({
  authority: 'https://login.microsoftonline.com/c0bbe169-6e15-4690-9712-9e2ec4773f9e',
  clientId: '9a1f14d7-c443-4ec7-a4bd-ac65fed43123',
  scope: 'openid profile email'
});

export const AuthButton: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<OidcUser | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const authenticated = await auth.isAuthenticated();
      setIsAuthenticated(authenticated);
      
      if (authenticated) {
        const currentUser = await auth.getUser();
        setUser(currentUser);
        console.log('Current user:', currentUser);
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      console.log('🔐 Starting OIDC login...');
      const user = await auth.loginPopup();
      if (user) {
        setIsAuthenticated(true);
        setUser(user);
        console.log('✅ Login successful!');
        console.log('🎫 Access Token:', user.access_token);
        console.log('🆔 ID Token:', user.id_token);
        if (user.refresh_token) {
          console.log('🔄 Refresh Token:', user.refresh_token);
        }
        console.log('👤 User Profile:', user.profile);
      }
    } catch (error) {
      console.error('❌ Login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      console.log('🚪 Logging out...');
      await auth.removeUser();
      setIsAuthenticated(false);
      setUser(null);
      console.log('✅ Logged out successfully');
    } catch (error) {
      console.error('❌ Logout failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const showTokens = async () => {
    try {
      const accessToken = await auth.getAccessToken();
      const idToken = await auth.getIdToken();
      
      console.log('=== 🎫 CURRENT TOKENS ===');
      console.log('Access Token:', accessToken);
      console.log('ID Token:', idToken);
      console.log('User Info:', user);
      console.log('========================');
    } catch (error) {
      console.error('Error getting tokens:', error);
    }
  };

  if (!isAuthenticated) {
    return (
      <Button
        onClick={handleLogin}
        disabled={loading}
        className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out disabled:opacity-50"
        title="Login with Microsoft"
      >
        {loading ? (
          <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
        ) : (
          <LogIn size={20} />
        )}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        onClick={showTokens}
        className="p-2 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 rounded transition-all duration-150 ease-out"
        title={`Logged in as ${user?.profile?.name || user?.profile?.email || 'User'} - Click to show tokens`}
      >
        <User size={20} />
      </Button>
      <Button
        onClick={handleLogout}
        disabled={loading}
        className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out disabled:opacity-50"
        title="Logout"
      >
        {loading ? (
          <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
        ) : (
          <LogOut size={20} />
        )}
      </Button>
    </div>
  );
};

export default AuthButton;
