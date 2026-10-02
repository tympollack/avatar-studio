/**
 * @module components/StudioShell
 *
 * Top-level layout shell for the Avatar Studio PWA.
 *
 * Responsibilities:
 *   1. Waits for AuthProvider session resolution.
 *   2. Fetches the cosmetic catalog from Supabase and dispatches SET_CATALOG.
 *   3. Loads the session user's persisted loadout into the canvas state after auth,
 *      and resets loadout on sign-out (Fixes Devin BUG_0002).
 *   4. Persists the active loadout to hub.user_cosmetic_loadouts on Save when authenticated;
 *      in guest mode, onSave is omitted so unsaved loadouts retain their dirty reminder
 *      (Fixes Devin BUG_0001).
 *   5. Mounts CanvasProvider → AvatarCanvasStage + InspectorDrawer.
 */

import type React from 'react';
import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { CanvasProvider } from '../store/CanvasProvider';
import { useCanvasStore } from '../store/canvasStore';
import { AvatarCanvasStage } from './canvas/AvatarCanvasStage';
import { InspectorDrawer } from './inspector/InspectorDrawer';
import type { CosmeticItem, UserCosmeticLoadout } from '../types/avatar';

// ──────────────────────────────────────────────
// Catalog loader (inner — needs CanvasProvider in tree)
// ──────────────────────────────────────────────

/**
 * CatalogLoader lives inside CanvasProvider so it can dispatch SET_CATALOG.
 * It fetches all cosmetic_items from the hub schema. Catalog items are public
 * per the hub.cosmetic_items_public_read RLS policy; tracking session user ID
 * ensures any session change re-runs the fetch lifecycle if catalog visibility
 * becomes user-gated in the future (Devin ANALYSIS_0001).
 */
const CatalogLoader: React.FC<{ userId?: string }> = ({ userId }) => {
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
    return () => {
      cancelled = true;
    };
  }, [dispatch, userId]);

  return null;
};

// ──────────────────────────────────────────────
// StudioEditor (inner — needs CanvasProvider in tree)
// ──────────────────────────────────────────────

interface StudioEditorProps {
  session: Session | null;
}

const StudioEditor: React.FC<StudioEditorProps> = ({ session }) => {
  const { state, dispatch } = useCanvasStore();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Load authenticated user's persisted loadout on sign-in, reset on sign-out (Devin BUG_0002)
  useEffect(() => {
    if (!session?.user?.id) {
      dispatch({ type: 'RESET_LOADOUT' });
      return;
    }

    let cancelled = false;

    async function loadUserLoadout() {
      const { data, error } = await supabase
        .schema('hub')
        .from('user_cosmetic_loadouts')
        .select('loadout')
        .eq('user_id', session!.user.id)
        .maybeSingle();

      if (error) {
        console.error('[StudioEditor] Failed to load saved cosmetic loadout:', error.message);
        return;
      }
      if (cancelled || !data?.loadout) return;

      const raw = data.loadout as Partial<UserCosmeticLoadout>;
      if (typeof raw === 'object' && raw !== null && Object.keys(raw).length > 0) {
        dispatch({
          type: 'LOAD_SAVED_LOADOUT',
          loadout: {
            frameId: typeof raw.frameId === 'string' ? raw.frameId : '',
            backgroundId: typeof raw.backgroundId === 'string' ? raw.backgroundId : '',
            backgroundTheme: raw.landscapeConfig?.theme ?? 'day',
            avatarConfig: raw.avatarConfig ?? { silhouetteId: '' },
            critters: Array.isArray(raw.critters) ? raw.critters : [],
            landscapeConfig: raw.landscapeConfig ?? {
              landscapeId: '',
              anchorCoordinates: { x: 0.5, y: 0.75 },
              theme: 'day',
            },
          },
        });
      }
    }

    void loadUserLoadout();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, dispatch]);

  /**
   * Save handler:
   * Only provided when user is authenticated. In guest mode, onSave is undefined
   * so clicking save does not mark the editor clean (Devin BUG_0001).
   * Awaits Supabase upsert and checks error before resolving.
   */
  const handleSave = session
    ? async () => {
        const loadoutPayload = {
          userId: session.user.id,
          frameId: state.frameId,
          backgroundId: state.backgroundId,
          avatarConfig: state.avatarConfig,
          critters: state.critters,
          landscapeConfig: state.landscapeConfig,
          renderUrls: {
            chip: '',
            profile: '',
            landscape: '',
            version: Date.now(),
          },
        };

        const { error } = await supabase
          .schema('hub')
          .from('user_cosmetic_loadouts')
          .upsert({
            user_id: session.user.id,
            loadout: loadoutPayload,
            updated_at: new Date().toISOString(),
          });

        if (error) {
          console.error('[StudioEditor] Failed to persist cosmetic loadout:', error.message);
          throw error;
        }
      }
    : undefined;

  return (
    <>
      <CatalogLoader userId={session?.user?.id} />

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
    </>
  );
};

// ──────────────────────────────────────────────
// StudioShell (root provider wrapper)
// ──────────────────────────────────────────────

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
    <CanvasProvider>
      <StudioEditor session={session} />
    </CanvasProvider>
  );
};
