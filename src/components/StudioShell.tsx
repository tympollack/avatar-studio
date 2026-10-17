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
import { useState, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import type Konva from 'konva';
import { ToastWarning } from './ui/ToastWarning';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { CanvasProvider } from '../store/CanvasProvider';
import type { CanvasState } from '../store/canvasStore';
import { useCanvasStore } from '../store/canvasStore';
import { AvatarCanvasStage } from './canvas/AvatarCanvasStage';
import { InspectorDrawer } from './inspector/InspectorDrawer';
import type { CosmeticItem, UserCosmeticLoadout } from '../types/avatar';
import { normalizeLayerType } from '../types/avatar';
import {
  exportAvatarBadges,
  downloadBadgeBlob,
  preloadImages,
  waitForStageReadiness,
} from '../utils/exportBadge';

export { ToastWarning };

// ──────────────────────────────────────────────
// Catalog loader (inner — needs CanvasProvider in tree)
// ──────────────────────────────────────────────

interface CatalogLoaderProps {
  userId?: string;
  onWarning?: (msg: string) => void;
}

/**
 * CatalogLoader lives inside CanvasProvider so it can dispatch SET_CATALOG.
 * It queries both universal catalog.assets for Kenney modular assets and
 * hub.cosmetic_items for existing items, providing full cross-game catalog integration.
 */
const CatalogLoader: React.FC<CatalogLoaderProps> = ({ userId, onWarning }) => {
  const { dispatch } = useCanvasStore();

  useEffect(() => {
    let cancelled = false;

    async function fetchCatalog() {
      let failedToFetchCdn = false;

      // 1. Fetch from catalog.assets for Kenney modular assets
      const { data: catalogData, error: catalogError } = await supabase
        .schema('catalog')
        .from('assets')
        .select('id, category, asset_key, cdn_url, metadata')
        .in('app_scope', ['all', 'avatar-studio']);

      if (catalogError) {
        console.warn('[CatalogLoader] Failed to fetch catalog.assets:', catalogError.message);
        failedToFetchCdn = true;
      }

      // 2. Fetch from hub.cosmetic_items for legacy/hub assets
      const { data: hubData, error: hubError } = await supabase
        .schema('hub')
        .from('cosmetic_items')
        .select('id, layer_type, name, asset_url, rarity, metadata');

      if (hubError) {
        console.warn('[CatalogLoader] Failed to fetch hub.cosmetic_items:', hubError.message);
        failedToFetchCdn = true;
      }

      if (cancelled) return;

      if (failedToFetchCdn) {
        if (!catalogData && !hubData) {
          onWarning?.('Asset manifest could not be fetched from CDN. Displaying offline fallbacks.');
        } else if (hubError && !catalogError) {
          onWarning?.('Some cosmetic items from Hub could not be loaded.');
        } else if (catalogError && !hubError) {
          onWarning?.('Some modular assets from catalog CDN could not be loaded.');
        }
      }
      if (!catalogData && !hubData) return;

      type CatalogAssetRow = {
        id: string;
        category: string;
        asset_key: string;
        cdn_url: string;
        metadata: Record<string, unknown> | null;
      };

      const catalogItems: CosmeticItem[] = (
        (catalogData as CatalogAssetRow[] | null) ?? []
      ).map((row) => ({
        id: row.id,
        layerType: normalizeLayerType(row.category),
        name:
          (row.metadata?.name as string) ||
          (row.metadata?.layer as string) ||
          row.asset_key.replace(/^avatar-/, '').replace(/-/g, ' '),
        assetUrl: row.cdn_url,
        rarity: ((row.metadata?.rarity as string) ?? 'standard') as CosmeticItem['rarity'],
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      }));

      type HubCatalogRow = {
        id: string;
        layer_type: string;
        name: string;
        asset_url: string;
        rarity: string | null;
        metadata: Record<string, unknown> | null;
      };

      const hubItems: CosmeticItem[] = (
        (hubData as HubCatalogRow[] | null) ?? []
      ).map((row) => ({
        id: row.id,
        layerType: normalizeLayerType(row.layer_type),
        name: row.name,
        assetUrl: row.asset_url,
        rarity: (row.rarity ?? 'standard') as CosmeticItem['rarity'],
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      }));

      const itemMap = new Map<string, CosmeticItem>();
      for (const item of catalogItems) {
        itemMap.set(item.id, item);
      }
      for (const item of hubItems) {
        if (!itemMap.has(item.id)) {
          itemMap.set(item.id, item);
        }
      }

      dispatch({ type: 'SET_CATALOG', items: Array.from(itemMap.values()) });
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
  const [cdnWarning, setCdnWarning] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

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
   * Resolves active asset URLs and detects any missing catalog items.
   */
  const resolveActiveAssetUrls = (currentState: CanvasState) => {
    const activeSlots: { slot: string; id?: string }[] = [
      { slot: 'background', id: currentState.backgroundId },
      { slot: 'landscape', id: currentState.landscapeConfig.landscapeId },
      { slot: 'silhouette', id: currentState.avatarConfig.silhouetteId },
      { slot: 'eyes', id: currentState.avatarConfig.eyesId },
      { slot: 'mouth', id: currentState.avatarConfig.mouthId },
      { slot: 'hair', id: currentState.avatarConfig.hairId },
      { slot: 'clothing', id: currentState.avatarConfig.clothingId },
      { slot: 'hat', id: currentState.avatarConfig.hatId },
      { slot: 'accessory', id: currentState.avatarConfig.accessoryId },
      { slot: 'handRig', id: currentState.avatarConfig.handRigId },
      ...currentState.critters.map((c, idx) => ({ slot: `critter_${idx}`, id: c.critterId })),
      { slot: 'frame', id: currentState.frameId },
    ];

    const urls: string[] = [];
    const missingAssetIds: string[] = [];

    for (const { slot, id } of activeSlots) {
      if (id) {
        const item = currentState.catalogIndex[id];
        if (!item || !item.assetUrl) {
          missingAssetIds.push(`${slot}:${id}`);
        } else {
          urls.push(item.assetUrl);
        }
      }
    }

    return { urls, missingAssetIds };
  };

  /**
   * Save handler:
   * Only provided when user is authenticated. In guest mode, onSave is undefined
   * so clicking save does not mark the editor clean (Devin BUG_0001).
   * Generates 128×128 and 512×512 WebP badges for universal profile consumption.
   * Awaits Supabase upsert and checks error before resolving.
   */
  const handleSave = session
    ? async () => {
        let chip = '';
        let profile = '';
        if (stageRef.current) {
          try {
            const { urls: activeUrls, missingAssetIds } = resolveActiveAssetUrls(state);
            if (missingAssetIds.length > 0) {
              throw new Error(
                `Selected assets missing from catalog: [${missingAssetIds.join(', ')}]`
              );
            }

            // Preload all active images so placeholders are never captured into badges
            await preloadImages(activeUrls);

            // Wait for stage Konva image nodes to commit and draw
            await waitForStageReadiness(stageRef.current, activeUrls);

            const badges = await exportAvatarBadges(stageRef.current);
            chip = badges.dataUrl128;
            profile = badges.dataUrl512;
          } catch (badgeErr) {
            console.error('[StudioEditor] Badge export failed during save:', badgeErr);
            throw new Error('Failed to generate avatar badges. Aborting save to prevent data corruption.');
          }
        }

        const loadoutPayload = {
          userId: session.user.id,
          frameId: state.frameId,
          backgroundId: state.backgroundId,
          avatarConfig: state.avatarConfig,
          critters: state.critters,
          landscapeConfig: state.landscapeConfig,
          renderUrls: {
            chip,
            profile,
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

  /**
   * Standalone badge export for user profile downloading.
   */
  const handleExportBadge = async (size: 128 | 512) => {
    if (!stageRef.current) return;
    try {
      const { urls: activeUrls, missingAssetIds } = resolveActiveAssetUrls(state);
      if (missingAssetIds.length > 0) {
        throw new Error(
          `Selected assets missing from catalog: [${missingAssetIds.join(', ')}]`
        );
      }

      await preloadImages(activeUrls);
      await waitForStageReadiness(stageRef.current, activeUrls);

      const badges = await exportAvatarBadges(stageRef.current, { allowFallbackOnTainted: true });
      if (size === 128) {
        downloadBadgeBlob(badges.blob128, 'avatar-badge-128x128.webp');
      } else {
        downloadBadgeBlob(badges.blob512, 'avatar-badge-512x512.webp');
      }
    } catch (err) {
      console.error('[StudioEditor] Failed to export badge:', err);
    }
  };

  return (
    <>
      <CatalogLoader userId={session?.user?.id} onWarning={setCdnWarning} />
      {cdnWarning && (
        <ToastWarning message={cdnWarning} onDismiss={() => setCdnWarning(null)} />
      )}

      <div className="flex h-full flex-col bg-slate-900">
        {/* Top nav */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-3">
          <span className="text-lg font-semibold tracking-tight text-slate-100">
            SunShade Avatar Studio
          </span>

          <div className="flex items-center gap-3">
            {/* Export Badges buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleExportBadge(128)}
                className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                title="Export flattened 128×128 WebP badge"
              >
                Export 128px
              </button>
              <button
                type="button"
                onClick={() => void handleExportBadge(512)}
                className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                title="Export high-resolution 512×512 WebP badge"
              >
                Export 512px
              </button>
            </div>

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
            <AvatarCanvasStage stageRef={stageRef} />
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
