import type React from 'react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { CanvasProvider } from '../store/CanvasProvider';
import { AvatarCanvasStage } from './canvas/AvatarCanvasStage';
import { InspectorDrawer } from './inspector/InspectorDrawer';

/**
 * StudioShell — top-level layout shell for the Avatar Studio PWA.
 *
 * Renders a loading spinner while the auth session resolves, then mounts the
 * full Phase 3 canvas editor: CanvasProvider → AvatarCanvasStage + InspectorDrawer.
 */
export const StudioShell: React.FC = () => {
  const { session, loading } = useAuth();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <CanvasProvider>
      <div className="flex h-full flex-col bg-slate-900">
        {/* Top nav */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-3">
          <span className="text-lg font-semibold tracking-tight text-slate-100">
            SunShade Avatar Studio
          </span>

          <div className="flex items-center gap-3">
            {/* Mobile drawer toggle */}
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-400 hover:text-slate-100 md:hidden"
              onClick={() => setMobileDrawerOpen((v) => !v)}
              aria-label="Toggle inspector"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>

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
          </div>
        </header>

        {/* Editor area: canvas + inspector side-by-side on desktop */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Canvas viewport */}
          <main className="flex flex-1 overflow-hidden">
            <AvatarCanvasStage />
          </main>

          {/* Inspector drawer (right panel desktop / slide-up mobile) */}
          <InspectorDrawer
            mobileOpen={mobileDrawerOpen}
            onMobileClose={() => setMobileDrawerOpen(false)}
            onSave={() => {
              // TODO Phase 4: trigger headless pre-render worker
              console.info('[StudioShell] Save & Pre-Render triggered');
            }}
          />
        </div>
      </div>
    </CanvasProvider>
  );
};
