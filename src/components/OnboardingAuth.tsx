import React, { useState, useEffect } from 'react';
import {
  Radio,
  Sparkles,
  ShieldCheck,
  Database,
  ArrowRight,
  User,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  Globe,
  Lock,
} from 'lucide-react';
import { GoogleUserProfile } from './GoogleAuthButton';
import {
  signInWithRealGoogle,
  fetchAuthConfig,
  AuthConfig,
} from '../services/google-auth';

interface OnboardingAuthProps {
  onAuthenticated: (user: GoogleUserProfile) => void;
  neonConfigured: boolean;
  onOpenNeonModal: () => void;
}

const AVATAR_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  indigo: { bg: 'bg-indigo-600', text: 'text-white', ring: 'ring-indigo-400' },
  emerald: { bg: 'bg-emerald-600', text: 'text-white', ring: 'ring-emerald-400' },
  purple: { bg: 'bg-purple-600', text: 'text-white', ring: 'ring-purple-400' },
  rose: { bg: 'bg-rose-600', text: 'text-white', ring: 'ring-rose-400' },
  amber: { bg: 'bg-amber-600', text: 'text-white', ring: 'ring-amber-400' },
  cyan: { bg: 'bg-cyan-600', text: 'text-white', ring: 'ring-cyan-400' },
};

export const OnboardingAuth: React.FC<OnboardingAuthProps> = ({
  onAuthenticated,
  neonConfigured,
  onOpenNeonModal,
}) => {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Direct email sign-in / profile setup
  const [emailInput, setEmailInput] = useState('killerbeast480@gmail.com');
  const [displayName, setDisplayName] = useState('Killer Beast');
  const [selectedColor, setSelectedColor] = useState('indigo');
  const [isCustomMode, setIsCustomMode] = useState(false);

  useEffect(() => {
    fetchAuthConfig().then((cfg) => {
      setAuthConfig(cfg);
      if (cfg?.username) {
        setDisplayName(cfg.username);
      }
    });
  }, []);

  // 1. Google OAuth Sign-in
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const profile = await signInWithRealGoogle();
      onAuthenticated(profile);
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setErrorMessage(err.message || 'Google Sign-In was cancelled or encountered an error.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Direct Account Sign-In (Syncs with Neon DB)
  const handleDirectSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Please enter a valid Gmail or email address.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const name = displayName.trim() || cleanEmail.split('@')[0];
    const profile: GoogleUserProfile = {
      id: `usr_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`,
      email: cleanEmail,
      name: name,
      domain: cleanEmail,
    };

    try {
      // Sync user profile with Neon DB backend
      const res = await fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to authenticate');
      }

      onAuthenticated(profile);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to sign in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Quick select preset profile
  const handleQuickSelect = (email: string, name: string, color: string) => {
    setEmailInput(email);
    setDisplayName(name);
    setSelectedColor(color);
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-black px-4 py-8 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white overflow-y-auto">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[120px]" />
        <div className="absolute -bottom-40 left-1/3 h-[450px] w-[450px] rounded-full bg-emerald-600/10 blur-[130px]" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 shadow-xl shadow-indigo-500/20 text-white ring-4 ring-indigo-500/10">
            <Radio className="h-8 w-8 animate-pulse" />
          </div>

          <div>
            <div className="flex items-center justify-center space-x-2">
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">D-Connect</h1>
              <span className="rounded-md border border-indigo-700/50 bg-indigo-950/80 px-2 py-0.5 text-[11px] font-mono font-bold text-indigo-400">
                P2P & Neon
              </span>
            </div>
            <p className="mt-1.5 text-xs text-[#8e8e93] sm:text-sm">
              Decentralized Peer-to-Peer Messenger with Neon DB Sync
            </p>
          </div>
        </div>

        {/* Card Box */}
        <div className="rounded-2xl border border-[#222226] bg-[#0c0c0e]/95 p-6 shadow-2xl backdrop-blur-xl space-y-5">
          {/* Neon DB Status Banner */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#141417] border border-[#222226] text-xs">
            <div className="flex items-center space-x-2 min-w-0">
              <Database className={`h-4 w-4 ${neonConfigured ? 'text-emerald-400' : 'text-indigo-400'} shrink-0`} />
              <div className="min-w-0">
                <span className="font-semibold text-white block truncate">
                  {neonConfigured ? 'Neon PostgreSQL Connected' : 'Neon Serverless Ready'}
                </span>
                <span className="text-[10px] text-[#8e8e93] block truncate">
                  Chats & friends stay saved across all devices
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenNeonModal}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold px-2 py-1 rounded bg-indigo-950/60 border border-indigo-800/40 shrink-0 cursor-pointer"
            >
              Config
            </button>
          </div>

          {/* Primary Action: Google Sign In */}
          <div className="space-y-2">
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center space-x-3 py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 text-sm font-bold transition shadow-md cursor-pointer disabled:opacity-50"
            >
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
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
              <span>{isLoading ? 'Signing in with Google...' : 'Continue with Google'}</span>
            </button>

            <p className="text-[11px] text-center text-[#8e8e93]">
              Supports any Google account (<code className="text-slate-300 font-mono">*@gmail.com</code>)
            </p>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-[#1e1e24]" />
            <span className="absolute bg-[#0c0c0e] px-2 text-[10px] uppercase font-bold tracking-wider text-[#636366]">
              or sign in with your email account
            </span>
          </div>

          {/* Quick preset sign-in accounts (for mobile or testing multi-user) */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-[#8e8e93] uppercase tracking-wider">
              Quick Select Account
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => handleQuickSelect('killerbeast480@gmail.com', 'Killer Beast', 'indigo')}
                className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  emailInput === 'killerbeast480@gmail.com'
                    ? 'border-indigo-500/80 bg-indigo-950/30'
                    : 'border-[#222226] bg-[#141417] hover:bg-[#1a1a1f]'
                }`}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-xs shrink-0">
                    KB
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">Killer Beast (Primary)</p>
                    <p className="text-[10px] font-mono text-[#8e8e93] truncate">killerbeast480@gmail.com</p>
                  </div>
                </div>
                {emailInput === 'killerbeast480@gmail.com' && (
                  <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleQuickSelect('friend.test@gmail.com', 'Alex Friend', 'emerald')}
                className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  emailInput === 'friend.test@gmail.com'
                    ? 'border-emerald-500/80 bg-emerald-950/30'
                    : 'border-[#222226] bg-[#141417] hover:bg-[#1a1a1f]'
                }`}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs shrink-0">
                    AF
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">Alex Friend (Contact)</p>
                    <p className="text-[10px] font-mono text-[#8e8e93] truncate">friend.test@gmail.com</p>
                  </div>
                </div>
                {emailInput === 'friend.test@gmail.com' && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                )}
              </button>
            </div>
          </div>

          {/* Form for custom email & username */}
          <form onSubmit={handleDirectSignIn} className="space-y-3 pt-1">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-[#8e8e93]">Gmail / Email Address</label>
                <button
                  type="button"
                  onClick={() => setIsCustomMode(!isCustomMode)}
                  className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                >
                  {isCustomMode ? 'Use Presets' : 'Custom Email'}
                </button>
              </div>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="your.email@gmail.com"
                required
                className="w-full px-3 py-2 rounded-xl bg-black border border-[#222226] text-white text-xs font-mono focus:border-indigo-500 focus:outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#8e8e93] mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Killer Beast"
                required
                className="w-full px-3 py-2 rounded-xl bg-black border border-[#222226] text-white text-xs focus:border-indigo-500 focus:outline-none transition"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md cursor-pointer disabled:opacity-50"
            >
              <span>{isLoading ? 'Synchronizing with Neon DB...' : 'Enter D-Connect Chat'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Error notice */}
          {errorMessage && (
            <div className="flex items-start space-x-2 p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Feature Highlights Footer */}
        <div className="grid grid-cols-3 gap-2 text-center text-[10px] text-[#8e8e93]">
          <div className="p-2 rounded-xl bg-[#0c0c0e] border border-[#1a1a1a]">
            <Smartphone className="h-4 w-4 mx-auto text-indigo-400 mb-1" />
            <p className="font-semibold text-white">Mobile Sync</p>
            <p className="text-[9px] text-[#636366]">Same data on phone & PC</p>
          </div>
          <div className="p-2 rounded-xl bg-[#0c0c0e] border border-[#1a1a1a]">
            <Database className="h-4 w-4 mx-auto text-emerald-400 mb-1" />
            <p className="font-semibold text-white">Neon DB</p>
            <p className="text-[9px] text-[#636366]">Serverless persistence</p>
          </div>
          <div className="p-2 rounded-xl bg-[#0c0c0e] border border-[#1a1a1a]">
            <Globe className="h-4 w-4 mx-auto text-cyan-400 mb-1" />
            <p className="font-semibold text-white">WebRTC P2P</p>
            <p className="text-[9px] text-[#636366]">Browser-to-browser</p>
          </div>
        </div>
      </div>
    </div>
  );
};
