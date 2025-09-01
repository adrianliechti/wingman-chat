import { User, UserManager } from 'oidc-client-ts';
import type { UserManagerSettings } from 'oidc-client-ts';

export interface AuthConfig {
  authority: string;
  clientId: string;
  redirectUri?: string;
  scope?: string;
}

export class Auth {
  private userManager: UserManager;

  constructor(config: AuthConfig) {
    
    const settings: UserManagerSettings = {
      authority: config.authority,
      client_id: config.clientId,
      redirect_uri: config.redirectUri || `${window.location.origin}/callback.html`,
      post_logout_redirect_uri: window.location.origin,
      response_type: 'code',
      scope: config.scope || 'openid profile email',
      automaticSilentRenew: true,
      silent_redirect_uri: `${window.location.origin}/silent-callback.html`,
      // Enable popup mode
      popup_redirect_uri: `${window.location.origin}/popup-callback.html`,
      popup_post_logout_redirect_uri: window.location.origin,
    };

    this.userManager = new UserManager(settings);
    
    // Set up event handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle user loaded event
    this.userManager.events.addUserLoaded((user: User) => {
      console.log('User loaded:', user);
      console.log('Access Token:', user.access_token);
      console.log('ID Token:', user.id_token);
      if (user.refresh_token) {
        console.log('Refresh Token:', user.refresh_token);
      }
    });

    // Handle user unloaded event
    this.userManager.events.addUserUnloaded(() => {
      console.log('User unloaded');
    });

    // Handle access token expiring
    this.userManager.events.addAccessTokenExpiring(() => {
      console.log('Access token expiring');
    });

    // Handle access token expired
    this.userManager.events.addAccessTokenExpired(() => {
      console.log('Access token expired');
    });

    // Handle silent renew error
    this.userManager.events.addSilentRenewError((error) => {
      console.error('Silent renew error:', error);
    });

    // Handle user sign-out
    this.userManager.events.addUserSignedOut(() => {
      console.log('User signed out');
    });
  }

  /**
   * Initiates the login flow using a popup window
   */
  public async loginPopup(): Promise<User | null> {
    try {
      console.log('Starting popup login...');
      const user = await this.userManager.signinPopup();
      console.log('Login successful:', user);
      console.log('Access Token:', user.access_token);
      console.log('ID Token:', user.id_token);
      return user;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  /**
   * Initiates the login flow using redirect
   */
  public async loginRedirect(): Promise<void> {
    try {
      console.log('Starting redirect login...');
      await this.userManager.signinRedirect();
    } catch (error) {
      console.error('Login redirect failed:', error);
      throw error;
    }
  }

  /**
   * Handles the callback after login redirect
   */
  public async handleCallback(): Promise<User | null> {
    try {
      console.log('Handling login callback...');
      const user = await this.userManager.signinRedirectCallback();
      console.log('Callback handled successfully:', user);
      console.log('Access Token:', user.access_token);
      console.log('ID Token:', user.id_token);
      return user;
    } catch (error) {
      console.error('Callback handling failed:', error);
      throw error;
    }
  }

  /**
   * Handles the popup callback
   */
  public async handlePopupCallback(): Promise<void> {
    try {
      console.log('Handling popup callback...');
      await this.userManager.signinPopupCallback();
      console.log('Popup callback handled successfully');
    } catch (error) {
      console.error('Popup callback handling failed:', error);
      throw error;
    }
  }

  /**
   * Gets the current user
   */
  public async getUser(): Promise<User | null> {
    try {
      const user = await this.userManager.getUser();
      if (user && !user.expired) {
        return user;
      }
      return null;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Logs out the user
   */
  public async logout(): Promise<void> {
    try {
      console.log('Logging out...');
      await this.userManager.signoutRedirect();
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }

  /**
   * Logs out the user using popup
   */
  public async logoutPopup(): Promise<void> {
    try {
      console.log('Logging out via popup...');
      await this.userManager.signoutPopup();
    } catch (error) {
      console.error('Popup logout failed:', error);
      throw error;
    }
  }

  /**
   * Removes the user session
   */
  public async removeUser(): Promise<void> {
    try {
      await this.userManager.removeUser();
      console.log('User session removed');
    } catch (error) {
      console.error('Error removing user:', error);
      throw error;
    }
  }

  /**
   * Checks if user is authenticated
   */
  public async isAuthenticated(): Promise<boolean> {
    const user = await this.getUser();
    return user !== null;
  }

  /**
   * Gets the access token
   */
  public async getAccessToken(): Promise<string | null> {
    const user = await this.getUser();
    return user?.access_token || null;
  }

  /**
   * Gets the ID token
   */
  public async getIdToken(): Promise<string | null> {
    const user = await this.getUser();
    return user?.id_token || null;
  }

  /**
   * Handles silent callback for token renewal
   */
  public async handleSilentCallback(): Promise<void> {
    try {
      await this.userManager.signinSilentCallback();
      console.log('Silent callback handled successfully');
    } catch (error) {
      console.error('Silent callback handling failed:', error);
      throw error;
    }
  }
}

/**
 * Create a new Auth instance
 */
export function createAuth(config: AuthConfig): Auth {
  return new Auth(config);
}

/**
 * Utility function to create callback handlers for different routes
 */
export const createCallbackHandlers = (auth: Auth) => ({
  // Handler for /callback route (redirect flow)
  handleRedirectCallback: () => auth.handleCallback(),
  
  // Handler for /popup-callback route (popup flow)
  handlePopupCallback: () => auth.handlePopupCallback(),
  
  // Handler for /silent-callback route (silent renewal)
  handleSilentCallback: () => auth.handleSilentCallback(),
});

// Example usage:
/*
const auth = createAuth({
  authority: 'https://your-oidc-provider.com',
  clientId: 'your-client-id',
  scope: 'openid profile email'
});

// Login with popup
auth.loginPopup().then(user => {
  console.log('Logged in user:', user);
}).catch(error => {
  console.error('Login failed:', error);
});

// Check if authenticated
auth.isAuthenticated().then(isAuth => {
  console.log('Is authenticated:', isAuth);
});

// Get access token
auth.getAccessToken().then(token => {
  console.log('Access token:', token);
});
*/
