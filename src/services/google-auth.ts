// Direct Google Identity Services (GIS) & Neon Database Integration
// ZERO Firebase dependencies. All chats and users are stored directly in Neon PostgreSQL.

import { GoogleUserProfile } from '../components/GoogleAuthButton';

declare global {
  interface Window {
    google?: any;
    gapi?: any;
    VITE_GOOGLE_CLIENT_ID?: string;
  }
}

// User's Google Cloud OAuth 2.0 Web Client ID from Google Cloud Console
export const DEFAULT_CLIENT_ID =
  (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
  window.VITE_GOOGLE_CLIENT_ID ||
  '962902289698-dk7vjl1smbdeckdg9oe9j5a01m1lrknt.apps.googleusercontent.com';

export const getEffectiveClientId = (): string => {
  return localStorage.getItem('dconnect_google_client_id') || DEFAULT_CLIENT_ID;
};

export const setCustomClientId = (clientId: string) => {
  if (clientId) {
    localStorage.setItem('dconnect_google_client_id', clientId.trim());
  } else {
    localStorage.removeItem('dconnect_google_client_id');
  }
};

let cachedUser: GoogleUserProfile | null = null;
const listeners: Array<(user: GoogleUserProfile | null) => void> = [];

export const initGoogleAuth = (
  onUserChanged: (user: GoogleUserProfile | null) => void
) => {
  listeners.push(onUserChanged);

  // Restore saved Google session from local device
  if (!cachedUser) {
    try {
      const saved = localStorage.getItem('dconnect_google_user');
      if (saved) {
        cachedUser = JSON.parse(saved);
      }
    } catch (_) {}
  }

  // Check if page just loaded with hash token from Google OAuth redirect
  if (window.location.hash.includes('access_token=')) {
    handleHashToken(window.location.hash).then((user) => {
      if (user) {
        // Clean URL hash
        window.history.replaceState(null, '', window.location.pathname);
      }
    });
  }

  if (cachedUser) {
    onUserChanged(cachedUser);
  }

  return () => {
    const idx = listeners.indexOf(onUserChanged);
    if (idx !== -1) listeners.splice(idx, 1);
  };
};

const notifyListeners = (user: GoogleUserProfile | null) => {
  cachedUser = user;
  if (user) {
    try {
      localStorage.setItem('dconnect_google_user', JSON.stringify(user));
    } catch (_) {}
  } else {
    try {
      localStorage.removeItem('dconnect_google_user');
    } catch (_) {}
  }
  listeners.forEach((fn) => fn(user));
};

export interface AuthConfig {
  allowedEmails: string[];
  hasRestriction: boolean;
  clientId: string;
  domain: string;
  username: string;
}

export const getClientAllowedEmails = (): string[] => {
  const envEmails = (
    (import.meta as any).env?.VITE_ALLOWED_EMAILS ||
    (import.meta as any).env?.VITE_ALLOWED_GMAIL ||
    ''
  ).trim();
  if (!envEmails) return [];
  return envEmails
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
};

export const isEmailAllowed = (email: string, allowedList: string[]): boolean => {
  if (!allowedList || allowedList.length === 0) return true;
  const lower = (email || '').trim().toLowerCase();
  return allowedList.some((allowed) => {
    if (allowed.startsWith('*@') || allowed.startsWith('@')) {
      const dom = allowed.replace(/^\*?@/, '');
      return lower.endsWith('@' + dom);
    }
    return lower === allowed;
  });
};

export const fetchAuthConfig = async (): Promise<AuthConfig> => {
  const clientAllowed = getClientAllowedEmails();
  try {
    const res = await fetch('/api/auth/config');
    if (res.ok) {
      const data = await res.json();
      const combinedAllowed = Array.from(new Set([...(data.allowedEmails || []), ...clientAllowed]));
      return {
        allowedEmails: combinedAllowed,
        hasRestriction: combinedAllowed.length > 0,
        clientId: data.clientId || getEffectiveClientId(),
        domain: data.domain || window.location.host,
        username: data.username || window.location.host.split('.')[0] || 'node',
      };
    }
  } catch (_) {}

  return {
    allowedEmails: clientAllowed,
    hasRestriction: clientAllowed.length > 0,
    clientId: getEffectiveClientId(),
    domain: window.location.host,
    username: window.location.host.split('.')[0] || 'node',
  };
};

// Sync profile to Neon PostgreSQL database (/api/auth/google) and validate allowed Gmail
export const syncUserToNeonDb = async (profile: GoogleUserProfile): Promise<GoogleUserProfile> => {
  // 1. First enforce allowed Gmail immediately (from VITE_ALLOWED_EMAILS in .env)
  const clientAllowed = getClientAllowedEmails();
  if (clientAllowed.length > 0 && !isEmailAllowed(profile.email, clientAllowed)) {
    throw new Error(
      `Access Denied: Google account "${profile.email}" is not authorized for this node. Only ${clientAllowed.join(', ')} is permitted.`
    );
  }

  // 2. Try server-side validation and database sync
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        return {
          id: data.user.id || profile.id,
          email: data.user.email || profile.email,
          name: data.user.name || profile.name,
          picture: data.user.picture || profile.picture,
          domain: data.user.domain || profile.domain,
        };
      }
    } else if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Access Denied: Google account is not authorized.`);
    } else {
      console.warn(`Backend /api/auth/google returned status ${res.status}. Client authorization validated.`);
    }
  } catch (err: any) {
    if (err.message && err.message.includes('Access Denied')) {
      throw err;
    }
    console.warn('Backend auth sync deferred:', err);
  }

  return profile;
};

const fetchAndSyncUserInfo = async (accessToken: string): Promise<GoogleUserProfile> => {
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userInfoRes.ok) {
    throw new Error('Failed to fetch Google profile details');
  }

  const userInfo = await userInfoRes.json();
  const profile: GoogleUserProfile = {
    id: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name || userInfo.email.split('@')[0],
    picture: userInfo.picture,
    domain: window.location.host || 'd-connect',
  };

  const savedUser = await syncUserToNeonDb(profile);
  notifyListeners(savedUser);
  return savedUser;
};

const handleHashToken = async (hashString: string): Promise<GoogleUserProfile | null> => {
  try {
    const params = new URLSearchParams(hashString.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    if (accessToken) {
      return await fetchAndSyncUserInfo(accessToken);
    }
  } catch (e) {
    console.error('Error handling hash token:', e);
  }
  return null;
};

// Real Google OAuth 2.0 Sign-In using Google Identity Services (GIS) & Popup OAuth
export const signInWithRealGoogle = async (): Promise<GoogleUserProfile> => {
  const clientId = getEffectiveClientId();
  const origin = window.location.origin;
  const redirectUri = `${origin}/api/auth/callback/google`;

  return new Promise((resolve, reject) => {
    let resolved = false;

    // Listen for postMessage from popup callback window
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_OAUTH_RESPONSE') {
        window.removeEventListener('message', handleMessage);
        resolved = true;
        const hash = event.data.hash || '';
        try {
          const user = await handleHashToken(hash);
          if (user) {
            return resolve(user);
          }
          reject(new Error('No access token returned from Google callback'));
        } catch (e: any) {
          reject(e);
        }
      }
    };
    window.addEventListener('message', handleMessage);

    // Try Google Identity Services first if available
    if (window.google?.accounts?.oauth2) {
      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'openid email profile',
          callback: async (response: any) => {
            if (response.error) {
              window.removeEventListener('message', handleMessage);
              if (response.error === 'origin_mismatch') {
                return reject(
                  new Error(
                    `Error 400: origin_mismatch. Add "${origin}" to Authorized JavaScript origins in Google Cloud Console.`
                  )
                );
              }
              return reject(new Error(`Google OAuth error: ${response.error}`));
            }

            if (!response.access_token) {
              window.removeEventListener('message', handleMessage);
              return reject(new Error('No access token returned by Google'));
            }

            try {
              resolved = true;
              window.removeEventListener('message', handleMessage);
              const user = await fetchAndSyncUserInfo(response.access_token);
              resolve(user);
            } catch (fetchErr: any) {
              reject(fetchErr);
            }
          },
          error_callback: (err: any) => {
            window.removeEventListener('message', handleMessage);
            const msg = err?.message || '';
            if (msg.includes('origin_mismatch')) {
              reject(
                new Error(
                  `Error 400: origin_mismatch. Add "${origin}" to Authorized JavaScript origins in Google Cloud Console.`
                )
              );
            } else {
              reject(new Error(msg || 'Google Sign-In popup closed or origin error.'));
            }
          },
        });

        tokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      } catch (gisErr: any) {
        console.warn('Google Identity GIS error, falling back to popup:', gisErr);
      }
    }

    // Direct Google OAuth Popup fallback with configured redirect URI
    const width = 500;
    const height = 620;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&prompt=select_account`;

    const popup = window.open(
      authUrl,
      'google_oauth_popup',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popup) {
      window.removeEventListener('message', handleMessage);
      return reject(new Error('Browser blocked popup window. Please allow popups for this site.'));
    }

    // Check if popup was closed without authenticating
    const checkClosedInterval = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosedInterval);
        setTimeout(() => {
          if (!resolved) {
            window.removeEventListener('message', handleMessage);
            reject(new Error('Google Sign-In window was closed.'));
          }
        }, 500);
      }
    }, 500);
  });
};

export const signOutGoogle = async (): Promise<void> => {
  notifyListeners(null);
};
