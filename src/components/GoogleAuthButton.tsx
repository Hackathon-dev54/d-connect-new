import React, { useState, useEffect } from 'react';
import { LogOut, CheckCircle2, AlertCircle, Settings, Copy, Check, ShieldCheck } from 'lucide-react';
import {
  signInWithRealGoogle,
  signOutGoogle,
  initGoogleAuth,
  getEffectiveClientId,
  setCustomClientId,
  DEFAULT_CLIENT_ID,
  fetchAuthConfig,
  AuthConfig,
} from '../services/google-auth';

export interface GoogleUserProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain?: string;
}

interface GoogleAuthButtonProps {
  currentUser: GoogleUserProfile | null;
  onUserAuthenticated: (user: GoogleUserProfile) => void;
  onSignOut: () => void;
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({
  currentUser,
  onUserAuthenticated,
  onSignOut,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [clientIdInput, setClientIdInput] = useState(getEffectiveClientId());
  const [copiedOrigin, setCopiedOrigin] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);

  useEffect(() => {
    fetchAuthConfig().then(setAuthConfig);
  }, []);

  // Listen to real Google auth state transitions
  useEffect(() => {
    const unsubscribe = initGoogleAuth((user) => {
      if (user) {
        onUserAuthenticated(user);
      }
    });
    return () => unsubscribe();
  }, [onUserAuthenticated]);

  const handleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const profile = await signInWithRealGoogle();
      onUserAuthenticated(profile);
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      const msg = err.message || 'Google Sign-In failed.';
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 12000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutGoogle();
    } catch (_) {}
    onSignOut();
  };

  const handleCopyOrigin = () => {
    navigator.clipboard.writeText(window.location.origin);
    setCopiedOrigin(true);
    setTimeout(() => setCopiedOrigin(false), 2000);
  };

  const handleSaveClientId = () => {
    setCustomClientId(clientIdInput.trim());
    setShowConfig(false);
  };

  if (currentUser) {
    return (
      <div className="flex items-center justify-between p-2 rounded-xl bg-[#141417] border border-[#222226]">
        <div className="flex items-center space-x-2.5 min-w-0">
          {currentUser.picture ? (
            <img
              src={currentUser.picture}
              alt={currentUser.name}
              className="h-7 w-7 rounded-full object-cover shrink-0 border border-emerald-500/50"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">
              {currentUser.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 truncate">
            <p className="text-xs font-bold text-white truncate flex items-center space-x-1">
              <span>{currentUser.name}</span>
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
            </p>
            <p className="text-[10px] text-emerald-400 truncate font-mono">{currentUser.email}</p>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          title="Sign out of Google"
          className="p-1.5 rounded-lg text-[#8e8e93] hover:text-rose-400 hover:bg-[#222226] transition cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center space-x-1">
        <button
          onClick={handleSignIn}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center space-x-2.5 px-3 py-2 rounded-xl bg-[#141417] border border-[#222226] hover:border-[#383842] text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 shadow-sm"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>{isLoading ? 'Connecting to Google...' : 'Sign in with Google'}</span>
        </button>

        <button
          onClick={() => setShowConfig(!showConfig)}
          title="Google OAuth Settings & Allowed Gmail"
          className="p-2 rounded-xl bg-[#141417] border border-[#222226] text-[#8e8e93] hover:text-white transition cursor-pointer"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {authConfig?.hasRestriction && (
        <div className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-[#141417] border border-[#222226] text-[10px] text-[#8e8e93]">
          <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
          <span className="truncate">
            Allowed: <span className="font-mono text-emerald-400 font-semibold">{authConfig.allowedEmails.join(', ')}</span> (.env)
          </span>
        </div>
      )}

      {showConfig && (
        <div className="p-3 rounded-xl bg-[#141417] border border-[#282830] text-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white text-[11px]">Domain Google Auth (.env)</span>
            <button
              onClick={() => {
                setClientIdInput(DEFAULT_CLIENT_ID);
                setCustomClientId('');
              }}
              className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
            >
              Reset Default
            </button>
          </div>

          <div>
            <label className="block text-[10px] text-[#8e8e93] mb-1">Allowed Gmail (.env configured):</label>
            <div className="p-1.5 rounded bg-black border border-[#222226] text-[10px] font-mono text-emerald-400">
              {authConfig?.allowedEmails?.length ? authConfig.allowedEmails.join(', ') : 'No restriction set (Any Gmail)'}
            </div>
            <p className="text-[9px] text-[#636366] mt-0.5">
              Set <code className="text-white">ALLOWED_GMAIL=email@gmail.com</code> in Vercel / .env to restrict.
            </p>
          </div>

          <div>
            <label className="block text-[10px] text-[#8e8e93] mb-1">Current Origin (Google Cloud):</label>
            <div className="flex items-center space-x-1">
              <input
                type="text"
                readOnly
                value={window.location.origin}
                className="flex-1 px-2 py-1 text-[10px] font-mono bg-black text-white rounded border border-[#222226] truncate"
              />
              <button
                onClick={handleCopyOrigin}
                className="p-1.5 rounded bg-[#222226] text-white hover:bg-[#333338] transition cursor-pointer"
                title="Copy Origin"
              >
                {copiedOrigin ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-[#8e8e93] mb-1">Web Client ID:</label>
            <input
              type="text"
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              className="w-full px-2 py-1 text-[10px] font-mono bg-black text-white rounded border border-[#222226]"
            />
          </div>

          <button
            onClick={handleSaveClientId}
            className="w-full py-1 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded transition cursor-pointer"
          >
            Save Configuration
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-800/50 text-[11px] text-rose-300 space-y-1.5">
          <div className="flex items-start space-x-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-400" />
            <span className="font-semibold leading-tight">{errorMessage}</span>
          </div>
          {errorMessage.includes('origin_mismatch') && (
            <div className="pt-1">
              <button
                onClick={handleCopyOrigin}
                className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-800 text-[10px] font-medium text-white transition cursor-pointer"
              >
                {copiedOrigin ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
                <span>Copy Current Origin ({window.location.origin})</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
