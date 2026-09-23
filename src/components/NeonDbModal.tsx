import React, { useState, useEffect } from 'react';
import { Database, CheckCircle2, AlertCircle, ExternalLink, RefreshCw, X, Layers, ShieldCheck } from 'lucide-react';

interface NeonDbModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigured?: (configured: boolean) => void;
}

export const NeonDbModal: React.FC<NeonDbModalProps> = ({ isOpen, onClose, onConfigured }) => {
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/db/status');
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data);
        if (data.configured) {
          onConfigured?.(true);
        }
      } else {
        const text = await res.text().catch(() => '');
        setDbStatus({
          configured: false,
          engine: `Server Error (${res.status})`,
          message: text.slice(0, 150) || `Server returned ${res.status}. Check Vercel Function logs.`,
        });
      }
    } catch (e: any) {
      setDbStatus({ configured: false, message: e.message || 'Network error fetching DB status' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-[#0c0c0e] border border-[#222226] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800/40">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Neon PostgreSQL Database</h3>
              <p className="text-[11px] text-[#8e8e93]">Vercel Managed Cloud Storage & Persistence</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8e8e93] hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Status card */}
        <div className="p-3.5 rounded-xl bg-[#141417] border border-[#222226] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#8e8e93] font-semibold">Engine Status:</span>
            <div className="flex items-center space-x-1.5">
              {loading ? (
                <span className="text-xs text-[#8e8e93]">Checking server...</span>
              ) : dbStatus?.configured ? (
                <span className="flex items-center space-x-1 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Neon PostgreSQL (Connected)</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1 text-xs font-semibold text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Local Memory Fallback</span>
                </span>
              )}
              <button
                onClick={fetchStatus}
                className="p-1 rounded text-[#8e8e93] hover:text-white transition cursor-pointer"
                title="Refresh DB Status"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {dbStatus?.database && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8e8e93]">Database Host:</span>
              <span className="font-mono text-white bg-black px-2 py-0.5 rounded border border-[#222226]">
                {dbStatus.database}
              </span>
            </div>
          )}

          {dbStatus?.detectedEnvKeys && dbStatus.detectedEnvKeys.length > 0 && (
            <div className="flex flex-col space-y-1 text-xs pt-1">
              <span className="text-[#8e8e93] text-[11px] font-semibold">Detected Server Environment Variables:</span>
              <div className="flex flex-wrap gap-1">
                {dbStatus.detectedEnvKeys.map((k: string) => (
                  <span
                    key={k}
                    className="font-mono text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 px-1.5 py-0.5 rounded"
                  >
                    ✓ {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-[#8e8e93] pt-1">
            {dbStatus?.message}
          </div>
        </div>

        {/* Database Tables & Live Counts */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-[#aeaeb2] uppercase tracking-wider flex items-center space-x-1.5">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            <span>Persisted Tables & Records</span>
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-[#141417] border border-[#222226] flex items-center justify-between">
              <div>
                <p className="font-bold text-white font-mono text-[11px]">users</p>
                <p className="text-[10px] text-[#8e8e93]">Google Auth profiles</p>
              </div>
              <span className="text-xs font-mono font-bold bg-black px-2 py-0.5 rounded text-emerald-400 border border-[#222226]">
                {dbStatus?.stats?.usersCount ?? 0}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#141417] border border-[#222226] flex items-center justify-between">
              <div>
                <p className="font-bold text-white font-mono text-[11px]">peers</p>
                <p className="text-[10px] text-[#8e8e93]">Friend requests & state</p>
              </div>
              <span className="text-xs font-mono font-bold bg-black px-2 py-0.5 rounded text-emerald-400 border border-[#222226]">
                {dbStatus?.stats?.peersCount ?? 0}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#141417] border border-[#222226] flex items-center justify-between">
              <div>
                <p className="font-bold text-white font-mono text-[11px]">messages</p>
                <p className="text-[10px] text-[#8e8e93]">P2P & Channel chats</p>
              </div>
              <span className="text-xs font-mono font-bold bg-black px-2 py-0.5 rounded text-emerald-400 border border-[#222226]">
                {dbStatus?.stats?.messagesCount ?? 0}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#141417] border border-[#222226] flex items-center justify-between">
              <div>
                <p className="font-bold text-white font-mono text-[11px]">channels</p>
                <p className="text-[10px] text-[#8e8e93]">Broadcast channels</p>
              </div>
              <span className="text-xs font-mono font-bold bg-black px-2 py-0.5 rounded text-emerald-400 border border-[#222226]">
                {dbStatus?.stats?.channelsCount ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Server Security Note */}
        <div className="p-3.5 rounded-xl bg-[#141417] border border-[#222226] space-y-1 text-xs">
          <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            <span>Server-Side Credentials Security</span>
          </div>
          <p className="text-[11px] text-[#8e8e93] leading-relaxed">
            Your database credentials are read securely from server-side environment variables (<code className="text-emerald-300">POSTGRES_URL</code> / <code className="text-emerald-300">DATABASE_URL</code>). They are never exposed to the client or browser bundle.
          </p>
        </div>

        {/* Vercel Neon Integration Guide */}
        <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-800/40 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-indigo-300">Vercel Environment Setup:</span>
            <a
              href="https://neon.com/docs/guides/vercel-managed-integration"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 text-[11px] font-semibold"
            >
              <span>Neon Docs</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="text-[#d1d1d6] text-[11px] leading-relaxed">
            When you add your Neon connection URL to your Vercel Project Environment Variables as <code className="text-indigo-200">POSTGRES_URL</code> or <code className="text-indigo-200">DATABASE_URL</code>, the serverless functions automatically connect and synchronize all channels, messages, and friend contacts.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
