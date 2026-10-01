/**
 * @module components/StudioShell
 *
 * Top-level layout shell for the Avatar Studio PWA.
 *
 * Responsibilities:
 *   1. Waits for AuthProvider session resolution.
 *   2. Fetches the cosmetic catalog from Supabase and dispatches SET_CATALOG
 *      so the inspector drawer has items to display. (Fixes Devin BUG_0001.)
 *   3. Mounts CanvasProvider → AvatarCanvasStage + InspectorDrawer.
 *   4. onSave returns a Promise — MARK_CLEAN only fires after successful save.
 */

import type React from 'react';
import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '@digitalcanopy/supabase';
import { CanvasProvider } from '../store/CanvasProvider';
import { useCanvasStore } from '../store/canvasStore';
import { AvatarCanvasStage } from './canvas/AvatarCanvasStage';
import { InspectorDrawer } from './inspector/InspectorDrawer';
import type { CosmeticItem } from '../types/avatar';

// ──────────────────────────────────────────────
// Catalog loader (inner — needs CanvasProvider in tree)
// ──────────────────────────────────────────────

/**
 * CatalogLoader lives inside CanvasProvider so it can dispatch SET_CATALOG.
 * It fetches all cosmetic_items from the hub schema on mount and re-fetches
 * whenever the session changes (in case catalog is user-gated in the future).
 */
const CatalogLoader: React.FC = () => {
  const { dispatch } = useCanvasStore();

  useEffect(() => {
    let cancelled = false;

    async function fetchCatalog() {
      const { data, error } = await supabase
        .schema('hub')
        .from('cosmetic_items')
        .select('id, layer_type, name, asset_url, rarity, metadata');

      if (error) {
        console.error('[CatalogLoader] Failed to fetch cosmetic catalog:', error.message);
        return;
      }
      if (cancelled || !data) return;

      type CatalogRow = {
        id: string;
        layer_type: string;
        name: string;
        asset_url: string;
        rarity: string | null;
        metadata: Record<string, unknown> | null;
      };

      const items: CosmeticItem[] = (data as CatalogRow[]).map((row) => ({
        id: row.id as string,
        layerType: row.layer_type as CosmeticItem['layerType'],
        name: row.name as string,
        assetUrl: row.asset_url as string,
        rarity: (row.rarity ?? 'standard') as CosmeticItem['rarity'],
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      }));

      dispatch({ type: 'SET_CATALOG', items });
    }

    void fetchCatalog();
    return () => { cancelled = true; };
  }, [dispatch]);

  // This component renders nothing — it's a side-effect-only data fetcher.
  return null;
};

// ──────────────────────────────────────────────
// StudioShell
// ──────────────────────────────────────────────

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

  /**
   * onSave — returns a Promise so InspectorDrawer can await it before
   * dispatching MARK_CLEAN. Phase 4 will replace the console.info with
   * an actual pre-render worker invocation.
   */
  const handleSave = async () => {
    // TODO Phase 4: await headless pre-render worker + Supabase loadout upsert
    console.info('[StudioShell] Save & Pre-Render triggered — Phase 4 will wire the worker');
    // Intentionally not throwing so MARK_CLEAN fires after this resolves.
  };

  return (
    <CanvasProvider>
      {/* Catalog fetch side-effect — must be inside CanvasProvider */}
      <CatalogLoader />

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
              <a
                href="https://hub.sunshade.icu"
                className="text-sm text-indigo-400 underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Sign in with Hub to Save
              </a>
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
          <main className="flex flex-1 overflow-hidden">
            <AvatarCanvasStage />
          </main>

          <InspectorDrawer
            mobileOpen={mobileDrawerOpen}
            onMobileClose={() => setMobileDrawerOpen(false)}
            onSave={handleSave}
          />
        </div>
      </div>
    </CanvasProvider>
  );
};
