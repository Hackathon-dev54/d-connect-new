import React, { useState, useEffect } from "react";
import { Database, X, CheckCircle2, AlertCircle, RefreshCw, ExternalLink, Layers, ShieldCheck, AlertTriangle } from "lucide-react";

interface NeonDbModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigured?: (configured: boolean) => void;
}

export const NeonDbModal: React.FC<NeonDbModalProps> = ({ isOpen, onClose, onConfigured }) => {
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<any>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/db/status");
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        setDbStatus(data);
        onConfigured?.(Boolean(data.configured));
      } catch (_) {
        setDbStatus({
          configured: false,
          engine: "Server Error",
          error: "FUNCTION_INVOCATION_ERROR",
          message: text.slice(0, 300) || `Server responded with status ${res.status}`,
        });
        onConfigured?.(false);
      }
    } catch (e: any) {
      setDbStatus({
        configured: false,
        engine: "Network Error",
        error: "NETWORK_ERROR",
        message: e?.message || "Failed to contact database status endpoint.",
      });
      onConfigured?.(false);
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

  const isConfigured = Boolean(dbStatus?.configured);
  const hasError = !isConfigured;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#1c1c1e] border border-[#2c2c2e] rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2c2c2e]">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-xl ${isConfigured ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              <Database className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Neon PostgreSQL Database
              </h3>
              <p className="text-xs text-[#8e8e93]">
                Server-Side Environment Variable Integration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8e8e93] hover:text-white cursor-pointer transition p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Engine Status Card */}
        <div className={`p-4 rounded-xl border space-y-3 ${
          isConfigured
            ? 'bg-[#141417] border-emerald-500/30'
            : 'bg-red-950/20 border-red-500/40'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#8e8e93] font-semibold">Engine Status:</span>
            <div className="flex items-center space-x-2">
              {loading ? (
                <span className="text-xs text-[#8e8e93]">Checking server environment...</span>
              ) : isConfigured ? (
                <span className="flex items-center space-x-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-md">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Neon PostgreSQL (Connected)</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1.5 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-2.5 py-1 rounded-md">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{dbStatus?.engine || "Database Error"}</span>
                </span>
              )}
              <button
                onClick={fetchStatus}
                className="p-1 rounded text-[#8e8e93] hover:text-white transition cursor-pointer"
                title="Refresh Status"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Database host if connected */}
          {dbStatus?.database && (
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-[#8e8e93]">Database Host:</span>
              <span className="font-mono text-emerald-300 bg-black/60 px-2 py-0.5 rounded border border-[#222226]">
                {dbStatus.database}
              </span>
            </div>
          )}

          {/* Detected variables */}
          {dbStatus?.detectedEnvKeys && dbStatus.detectedEnvKeys.length > 0 && (
            <div className="flex flex-col space-y-1 text-xs pt-1">
              <span className="text-[#8e8e93] text-[11px] font-semibold">Detected Server Environment Variable:</span>
              <div className="flex flex-wrap gap-1">
                {dbStatus.detectedEnvKeys.map((k: string) => (
                  <span
                    key={k}
                    className="font-mono text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 px-2 py-0.5 rounded"
                  >
                    ✓ {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Prominent Error Details Banner if not configured */}
          {hasError && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 space-y-2 text-xs">
              <div className="flex items-center space-x-1.5 text-red-400 font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Configuration Action Required</span>
              </div>
              <p className="text-red-200 text-[11px] leading-relaxed">
                {dbStatus?.message || "No PostgreSQL database URL detected from environment variables."}
              </p>
              <div className="text-[11px] text-[#aeaeb2] space-y-1 pt-1 border-t border-red-800/30">
                <p className="font-semibold text-white">To resolve on Vercel:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-[#d1d1d6]">
                  <li>Go to your project in <span className="text-white font-medium">Vercel Dashboard</span></li>
                  <li>Click <span className="text-white font-medium">Settings → Environment Variables</span></li>
                  <li>Verify <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">POSTGRES_URL</code> or <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">DATABASE_URL</code> is added for Production &amp; Preview</li>
                  <li className="text-amber-300 font-semibold">IMPORTANT: Click &quot;Redeploy&quot; in Vercel Deployments (serverless functions do not update until redeployed)</li>
                </ol>
              </div>
            </div>
          )}

          {/* Success message */}
          {isConfigured && (
            <div className="text-[11px] text-emerald-400 pt-1">
              ✓ {dbStatus?.message || "Neon PostgreSQL connected and active."}
            </div>
          )}
        </div>

        {/* Database Tables & Live Counts */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-[#aeaeb2] uppercase tracking-wider flex items-center space-x-1.5">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            <span>Persisted Tables &amp; Records</span>
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
                <p className="text-[10px] text-[#8e8e93]">Friend requests &amp; state</p>
              </div>
              <span className="text-xs font-mono font-bold bg-black px-2 py-0.5 rounded text-emerald-400 border border-[#222226]">
                {dbStatus?.stats?.peersCount ?? 0}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#141417] border border-[#222226] flex items-center justify-between">
              <div>
                <p className="font-bold text-white font-mono text-[11px]">messages</p>
                <p className="text-[10px] text-[#8e8e93]">P2P &amp; Channel chats</p>
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
        <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-1 text-xs">
          <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            <span>Environment Variable Security</span>
          </div>
          <p className="text-[11px] text-[#8e8e93] leading-relaxed">
            Your database credentials are read strictly from server-side environment variables (<code className="text-emerald-300">POSTGRES_URL</code> or <code className="text-emerald-300">DATABASE_URL</code>). They are never exposed to the client or browser bundle.
          </p>
        </div>

        {/* Vercel Neon Integration Guide */}
        <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-800/40 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-indigo-300">Neon Vercel Integration:</span>
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
            Neon provides managed Postgres connection pooling. Once connected, changes made from any peer node or browser sync automatically in real-time.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
