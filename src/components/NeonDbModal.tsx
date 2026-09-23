import React, { useState, useEffect } from 'react';
import { Database, CheckCircle2, AlertCircle, ExternalLink, RefreshCw, X, Layers, Key, Check } from 'lucide-react';

interface NeonDbModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigured?: (configured: boolean) => void;
}

export const NeonDbModal: React.FC<NeonDbModalProps> = ({ isOpen, onClose, onConfigured }) => {
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [customUrlInput, setCustomUrlInput] = useState(() => {
    return localStorage.getItem('dconnect_neon_db_url') || '';
  });
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const savedUrl = localStorage.getItem('dconnect_neon_db_url') || '';
      const res = await fetch('/api/db/status', {
        headers: savedUrl ? { 'x-neon-db-url': savedUrl } : {},
      });
      const data = await res.json();
      setDbStatus(data);
      if (data.configured) {
        onConfigured?.(true);
      }
    } catch (e: any) {
      setDbStatus({ configured: false, message: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem('dconnect_neon_db_url') || '';
      if (saved) setCustomUrlInput(saved);
      fetchStatus();
    }
  }, [isOpen]);

  const handleSaveCustomDb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrlInput.trim()) return;

    setIsSavingUrl(true);
    try {
      const trimmed = customUrlInput.trim();
      localStorage.setItem('dconnect_neon_db_url', trimmed);

      const res = await fetch('/api/db/configure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-neon-db-url': trimmed,
        },
        body: JSON.stringify({ databaseUrl: trimmed }),
      });
      const data = await res.json();
      if (data.status) {
        setDbStatus(data.status);
        if (data.status.configured) {
          onConfigured?.(true);
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (e: any) {
      alert('Failed to connect: ' + e.message);
    } finally {
      setIsSavingUrl(false);
    }
  };

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
              <p className="text-[11px] text-[#8e8e93]">Vercel Managed Integration & Cloud Storage</p>
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
                <span className="text-xs text-[#8e8e93]">Checking...</span>
              ) : dbStatus?.configured ? (
                <span className="flex items-center space-x-1 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Neon PostgreSQL (Live)</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1 text-xs font-semibold text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Memory Fallback (Ready for Neon)</span>
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
              <span className="text-[#8e8e93]">Connected DB:</span>
              <span className="font-mono text-white bg-black px-2 py-0.5 rounded border border-[#222226]">
                {dbStatus.database}
              </span>
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
            <span>Persisted Tables & Data Records</span>
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

        {/* Dynamic Neon DB Connection Input */}
        <div className="p-3.5 rounded-xl bg-[#141417] border border-[#222226] space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white flex items-center space-x-1.5">
              <Key className="h-3.5 w-3.5 text-emerald-400" />
              <span>Connect Neon Database URL</span>
            </span>
            {saveSuccess && (
              <span className="text-emerald-400 text-[10px] font-bold flex items-center space-x-1">
                <Check className="h-3 w-3" />
                <span>Connected!</span>
              </span>
            )}
          </div>
          <form onSubmit={handleSaveCustomDb} className="space-y-2">
            <input
              type="password"
              placeholder="postgres://user:password@ep-xyz.neon.tech/neondb?sslmode=require"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-[#222226] text-white text-xs font-mono focus:border-indigo-500 focus:outline-hidden"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#8e8e93]">
                Auto-read on Vercel via <code className="text-emerald-400">DATABASE_URL</code>
              </span>
              <button
                type="submit"
                disabled={isSavingUrl || !customUrlInput.trim()}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition cursor-pointer"
              >
                {isSavingUrl ? 'Connecting...' : 'Connect URL'}
              </button>
            </div>
          </form>
        </div>

        {/* Vercel Neon Integration Guide */}
        <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-800/40 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-indigo-300">Vercel Managed Integration:</span>
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
          <ol className="list-decimal list-inside space-y-1 text-[#d1d1d6] text-[11px] leading-relaxed">
            <li>In your Vercel Project Dashboard, open the <strong>Storage</strong> tab.</li>
            <li>Click <strong>Connect Database</strong> and choose <strong>Neon Postgres</strong>.</li>
            <li>Vercel automatically sets <code>POSTGRES_URL</code> and <code>DATABASE_URL</code>!</li>
            <li>Redeploy on Vercel — all friend requests, chats, and accounts persist to Neon!</li>
          </ol>
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
