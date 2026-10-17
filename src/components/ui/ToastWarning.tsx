import type React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ToastWarningProps {
  message: string;
  onDismiss: () => void;
}

export const ToastWarning: React.FC<ToastWarningProps> = ({ message, onDismiss }) => (
  <div
    role="status"
    aria-live="polite"
    className="fixed top-16 right-4 z-50 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-slate-900/95 px-3.5 py-2.5 text-xs text-amber-200 shadow-xl shadow-black/50 backdrop-blur transition-all"
  >
    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
    <span className="font-medium">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss notification"
      className="ml-2 rounded p-1 text-slate-400 hover:text-white transition-colors"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  </div>
);
