import type React from 'react';
import { useAuth } from '../auth/AuthProvider';

/**
 * StudioShell — top-level layout shell for the Avatar Studio PWA.
 *
 * Renders a loading spinner while the auth session resolves,
 * then delegates to the canvas editor view.
 */
export const StudioShell: React.FC = () => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-900">
      {/* Top nav */}
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <span className="text-lg font-semibold tracking-tight text-slate-100">
          SunShade Avatar Studio
        </span>
        {!session && (
          <span className="text-sm text-slate-400">
            Authenticate with Hub to Save
          </span>
        )}
        {session && (
          <span className="text-sm text-slate-400">
            {session.user.email}
          </span>
        )}
      </header>

      {/* Canvas area placeholder */}
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">
          Canvas editor coming in Phase 3 · STORY-AVATAR-CANVAS-ENGINE
        </p>
      </main>
    </div>
  );
};
