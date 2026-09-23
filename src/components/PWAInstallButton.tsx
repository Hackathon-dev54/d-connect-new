import React from 'react';
import { Download, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, installPWA } = usePWAInstall();

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={installPWA}
        className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold text-xs shadow-md shadow-indigo-500/25 transition active:scale-98"
      >
        <Download className="h-4 w-4" />
        <span>Install App (.apk / PWA)</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
        <div className="flex items-center space-x-1.5 font-semibold text-slate-700 dark:text-slate-300">
          <Smartphone className="h-3.5 w-3.5 text-indigo-500" />
          <span>Install on iOS</span>
        </div>
        <p>Tap Share (square with arrow) & select "Add to Home Screen".</p>
      </div>
    );
  }

  return null;
}
