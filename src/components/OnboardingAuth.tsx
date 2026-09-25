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
  Globe,
  Cpu,
  Layers,
} from 'lucide-react';
import { GoogleUserProfile } from './GoogleAuthButton';
import {
  signInWithRealGoogle,
  fetchAuthConfig,
  AuthConfig,
} from '../services/google-auth';
import { cleanDomain, deriveSubdomain } from '../utils/domain';

interface OnboardingAuthProps {
  onAuthenticated: (user: GoogleUserProfile) => void;
  neonConfigured: boolean;
  onOpenNeonModal: () => void;
}

export const OnboardingAuth: React.FC<OnboardingAuthProps> = ({
  onAuthenticated,
  neonConfigured,
  onOpenNeonModal,
}) => {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-detect domain & auto-assign username from subdomain/domain
  const currentHost = typeof window !== 'undefined' ? window.location.host : '';
  const detectedDomain = cleanDomain(currentHost) || 'node.chat.local';
  const detectedSubdomain = deriveSubdomain(detectedDomain) || 'node';

  // State for optional custom username
  const [usernameInput, setUsernameInput] = useState(() => detectedSubdomain);
  const [showCustomInput, setShowCustomInput] = useState(false);

  useEffect(() => {
    fetchAuthConfig().then((cfg) => {
      setAuthConfig(cfg);
      if (cfg?.username && !cfg.username.startsWith('PeerNode_')) {
        setUsernameInput(cfg.username);
      }
    });
  }, []);

  // Quick 1-click sign in with the auto-assigned subdomain identity
  const handleQuickSubdomainEntry = async (customName?: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    const chosenName = (customName || usernameInput || detectedSubdomain).trim();
    const cleanUserEmail = `${chosenName}@${detectedDomain}`;

    const profile: GoogleUserProfile = {
      id: `usr_${chosenName.replace(/[^a-zA-Z0-9]/g, '_')}`,
      email: cleanUserEmail,
      name: chosenName,
      domain: detectedDomain,
    };

    try {
      // Sync user profile with database backend
      const res = await fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to initialize node identity');
      }

      onAuthenticated(profile);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to enter node. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Google OAuth Sign-in
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const profile = await signInWithRealGoogle();
      onAuthenticated(profile);
    } catch (err: any) {
      setErrorMessage(err.message || 'Google Sign-In was cancelled or encountered an error.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#090a0f] px-4 py-8 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white overflow-y-auto">
      {/* Dynamic ambient grid & glowing background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[550px] w-[550px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-indigo-600/20 via-cyan-500/15 to-transparent blur-[140px]" />
        <div className="absolute -bottom-40 right-1/4 h-[450px] w-[450px] rounded-full bg-emerald-600/10 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)`,
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 p-0.5 shadow-2xl shadow-indigo-500/30">
            <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-[#0c0d14]">
              <Radio className="h-8 w-8 text-cyan-400 animate-pulse" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-center space-x-2">
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">D-Connect</h1>
              <span className="rounded-md border border-cyan-500/30 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300">
                Web Crawler 2.1
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-400 sm:text-sm">
              Zero-Lag Web Crawler Federation & Persistent Database Storage
            </p>
          </div>
        </div>

        {/* Card Box */}
        <div className="rounded-3xl border border-slate-800/80 bg-[#0e1017]/90 p-6 shadow-2xl backdrop-blur-2xl space-y-5">
          {/* Database & Crawler Status Pill */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-[#131622] border border-slate-800/80 text-xs">
            <div className="flex items-center space-x-2.5 min-w-0">
              <Database className={`h-4 w-4 ${neonConfigured ? 'text-emerald-400' : 'text-cyan-400'} shrink-0`} />
              <div className="min-w-0">
                <div className="flex items-center space-x-1.5">
                  <span className="font-semibold text-white truncate text-xs">
                    {neonConfigured ? 'Neon PostgreSQL Live' : 'Database Ready'}
                  </span>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <span className="text-[10px] text-slate-400 block truncate font-mono">
                  Pure DB saves all · 0 lags · No SSE
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenNeonModal}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold px-2.5 py-1 rounded-lg bg-cyan-950/50 border border-cyan-800/50 shrink-0 cursor-pointer transition"
            >
              DB Config
            </button>
          </div>

          {/* Auto-Assigned Subdomain Identity Spotlight */}
          <div className="rounded-2xl border border-indigo-500/40 bg-gradient-to-b from-indigo-950/40 to-slate-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-indigo-300 flex items-center space-x-1.5">
                <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                <span>Auto-Assigned Node Identity</span>
              </span>
              <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/40">
                Global Unique
              </span>
            </div>

            <div className="flex items-center space-x-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white font-black text-sm uppercase shadow-lg shadow-indigo-600/30 shrink-0">
                {detectedSubdomain.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm font-black text-white truncate font-mono">
                    #{usernameInput || detectedSubdomain}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-400 truncate">
                  @{detectedDomain}
                </p>
              </div>
            </div>

            {/* Custom handle toggle */}
            {showCustomInput ? (
              <div className="pt-1">
                <label className="block text-[11px] text-slate-400 font-medium mb-1">
                  Custom Node Username (optional):
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    placeholder={detectedSubdomain}
                    className="flex-1 px-3 py-1.5 rounded-xl bg-black border border-slate-700 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCustomInput(false)}
                    className="text-[11px] text-slate-400 hover:text-white px-2 py-1"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                <span>Derived from site domain/subdomain</span>
                <button
                  type="button"
                  onClick={() => setShowCustomInput(true)}
                  className="text-cyan-400 hover:underline cursor-pointer"
                >
                  Edit handle
                </button>
              </div>
            )}

            {/* PRIMARY ACTION: Enter with Auto-Assigned Subdomain */}
            <button
              onClick={() => handleQuickSubdomainEntry()}
              disabled={isLoading}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-sm font-bold shadow-lg shadow-indigo-600/30 transition transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer disabled:opacity-50"
            >
              <span>{isLoading ? 'Connecting Crawler Node...' : `Enter as #${usernameInput || detectedSubdomain}`}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-slate-800" />
            <span className="absolute bg-[#0e1017] px-3 text-[10px] uppercase font-bold tracking-widest text-slate-500">
              or
            </span>
          </div>

          {/* Secondary Action: Real Google Sign In */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center space-x-3 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
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
            <span>Continue with Google Account</span>
          </button>

          {/* Error notice */}
          {errorMessage && (
            <div className="flex items-start space-x-2 p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Feature Highlights Footer */}
        <div className="grid grid-cols-3 gap-2.5 text-center text-[10px]">
          <div className="p-2.5 rounded-2xl bg-[#0e1017] border border-slate-800/80">
            <Globe className="h-4 w-4 mx-auto text-cyan-400 mb-1" />
            <p className="font-bold text-white">Crawler Method</p>
            <p className="text-[9px] text-slate-500">Cross-subdomain pings</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-[#0e1017] border border-slate-800/80">
            <Database className="h-4 w-4 mx-auto text-emerald-400 mb-1" />
            <p className="font-bold text-white">Pure DB Saves</p>
            <p className="text-[9px] text-slate-500">Neon PostgreSQL storage</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-[#0e1017] border border-slate-800/80">
            <Layers className="h-4 w-4 mx-auto text-indigo-400 mb-1" />
            <p className="font-bold text-white">Zero Hangs</p>
            <p className="text-[9px] text-slate-500">Fast on-demand sync</p>
          </div>
        </div>
      </div>
    </div>
  );
};
