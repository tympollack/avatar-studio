/**
 * @module components/inspector/InspectorDrawer
 *
 * Drawer-based customization inspector panel.
 *
 * Renders the five-category switcher bar [Frame | Background | Avatar | Companion | Landscape]
 * and the corresponding asset grid + tint picker for tintable categories.
 *
 * Devin fixes applied:
 *   BUG_0002 — Save does not mark clean until onSave resolves (or if no persistence
 *              exists yet, shows a "saving…" disabled state while calling onSave).
 *   BUG_0005 — Avatar tab now includes 'avatar_clothing' in TAB_LAYER_TYPES and
 *              dispatches clothingId for avatar_clothing items.
 *   BUG_0006 — activeId replaced by getIsSelected(item) callback passed to AssetGrid,
 *              comparing each card against the correct state field for its layer type.
 *
 * Mobile behaviour (< 768px): drawer slides up from the bottom and collapses
 * to a tab bar. Desktop: fixed right-side panel (320px wide).
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { useCanvasStore } from '../../store/canvasStore';
import { INSPECTOR_TABS, useInspectorTabs } from './useInspectorTabs';
import type { InspectorTab } from './useInspectorTabs';
import { AssetGrid } from './AssetGrid';
import { TintPicker } from './TintPicker';
import type { CosmeticItem, CosmeticLayerType, CritterPerchLocation } from '../../types/avatar';

// ──────────────────────────────────────────────
// Tab → layer type mapping
// ──────────────────────────────────────────────

const TAB_LAYER_TYPES: Record<InspectorTab, CosmeticLayerType[]> = {
  Frame: ['frame'],
  Background: ['background'],
  // Avatar tab now includes clothing so all three avatar sub-layers are selectable.
  Avatar: ['avatar_body', 'avatar_hand', 'avatar_clothing'],
  Companion: ['critter'],
  Landscape: ['landscape'],
};

// ──────────────────────────────────────────────
// Tab strip
// ──────────────────────────────────────────────

interface TabStripProps {
  activeTab: InspectorTab;
  isDirty: boolean;
  onSelect: (tab: InspectorTab) => void;
}

const TabStrip: React.FC<TabStripProps> = ({ activeTab, isDirty, onSelect }) => (
  <div
    className="flex shrink-0 overflow-x-auto border-b border-slate-700 bg-slate-900"
    role="tablist"
    aria-label="Inspector categories"
  >
    {INSPECTOR_TABS.map((tab) => (
      <button
        key={tab}
        type="button"
        role="tab"
        aria-selected={activeTab === tab}
        onClick={() => onSelect(tab)}
        className={clsx(
          'relative flex-1 whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors',
          activeTab === tab
            ? 'border-b-2 border-indigo-500 text-indigo-400'
            : 'text-slate-400 hover:text-slate-200',
        )}
      >
        {tab}
        {/* Unsaved indicator dot — only on active-but-dirty tabs */}
        {isDirty && activeTab === tab && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
        )}
      </button>
    ))}
  </div>
);

// ──────────────────────────────────────────────
// Save & Pre-Render FAB
// ──────────────────────────────────────────────

interface SaveFABProps {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
}

const SaveFAB: React.FC<SaveFABProps> = ({ isDirty, isSaving, onSave }) => {
  if (!isDirty) return null;

  return (
    <div className="sticky bottom-0 shrink-0 border-t border-slate-700 bg-slate-900 p-3">
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving}
        className={clsx(
          'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5',
          'text-sm font-semibold text-white',
          'transition-all duration-150',
          isSaving
            ? 'cursor-not-allowed bg-indigo-800 opacity-60'
            : 'bg-indigo-600 hover:bg-indigo-500 active:scale-95 shadow-lg shadow-indigo-900/50',
        )}
      >
        {isSaving ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
            Saving…
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
            Save &amp; Pre-Render
          </>
        )}
      </button>
    </div>
  );
};

// ──────────────────────────────────────────────
// Main Drawer
// ──────────────────────────────────────────────

interface InspectorDrawerProps {
  /** Called when user confirms "Save & Pre-Render". Should return a Promise so
   *  the drawer can await resolution before marking the state clean. */
  onSave?: () => Promise<void> | void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({
  onSave,
  mobileOpen = true,
  onMobileClose,
}) => {
  const { state, dispatch } = useCanvasStore();
  const { activeTab, setActiveTab } = useInspectorTabs();
  const [isSaving, setIsSaving] = useState(false);

  // ── Catalog filtering ─────────────────────
  const layerTypes = TAB_LAYER_TYPES[activeTab];
  const filteredItems: CosmeticItem[] = Object.values(state.catalogIndex).filter(
    (item) => layerTypes.includes(item.layerType),
  );

  // ── Selection handler ─────────────────────
  const handleSelect = useCallback((id: string) => {
    switch (activeTab) {
      case 'Frame':
        dispatch({ type: 'SET_FRAME', frameId: id });
        break;
      case 'Background':
        dispatch({ type: 'SET_BACKGROUND', backgroundId: id });
        break;
      case 'Avatar': {
        const item = state.catalogIndex[id];
        if (item?.layerType === 'avatar_body') {
          dispatch({ type: 'SET_AVATAR_CONFIG', config: { silhouetteId: id } });
        } else if (item?.layerType === 'avatar_hand') {
          dispatch({ type: 'SET_AVATAR_CONFIG', config: { handRigId: id } });
        } else if (item?.layerType === 'avatar_clothing') {
          dispatch({ type: 'SET_AVATAR_CONFIG', config: { clothingId: id } });
        }
        break;
      }
      case 'Companion': {
        const existing = state.critters.find((c) => c.critterId === id);
        if (existing) {
          dispatch({
            type: 'SET_CRITTERS',
            critters: state.critters.filter((c) => c.critterId !== id),
          });
        } else {
          // Assign next available perch socket, preventing companions from overlapping.
          // (Fixes Devin BUG_0005.)
          const ALL_PERCHES: CritterPerchLocation[] = ['shoulder', 'hover', 'ground', 'pocket'];
          const occupied = new Set(state.critters.map((c) => c.perchLocation));
          const availablePerch = ALL_PERCHES.find((p) => !occupied.has(p));

          if (availablePerch) {
            dispatch({
              type: 'SET_CRITTERS',
              critters: [
                ...state.critters,
                { critterId: id, perchLocation: availablePerch },
              ],
            });
          } else {
            // All perch locations occupied: replace the last equipped companion
            // using its perch location so all companions stay on distinct sockets.
            const lastPerch = state.critters[state.critters.length - 1].perchLocation;
            dispatch({
              type: 'SET_CRITTERS',
              critters: [
                ...state.critters.slice(0, -1),
                { critterId: id, perchLocation: lastPerch },
              ],
            });
          }
        }
        break;
      }
      case 'Landscape':
        dispatch({ type: 'SET_LANDSCAPE', config: { landscapeId: id } });
        break;
    }
  }, [activeTab, state.catalogIndex, state.critters, dispatch]);

  // ── Tint handler ──────────────────────────
  const handleTintChange = useCallback((hex: string | undefined) => {
    dispatch({ type: 'SET_AVATAR_CONFIG', config: { tintColor: hex } });
  }, [dispatch]);

  /**
   * Updates an equipped companion's perch socket. If another companion already
   * occupies that socket, their locations are swapped so all companions remain
   * on distinct sockets without overlapping.
   */
  const handlePerchChange = useCallback((critterId: string, nextPerch: CritterPerchLocation) => {
    const current = state.critters.find((c) => c.critterId === critterId);
    if (!current || current.perchLocation === nextPerch) return;

    const otherWithPerch = state.critters.find(
      (c) => c.critterId !== critterId && c.perchLocation === nextPerch,
    );

    const updated = state.critters.map((c) => {
      if (c.critterId === critterId) {
        return { ...c, perchLocation: nextPerch };
      }
      if (otherWithPerch && c.critterId === otherWithPerch.critterId) {
        return { ...c, perchLocation: current.perchLocation };
      }
      return c;
    });

    dispatch({ type: 'SET_CRITTERS', critters: updated });
  }, [state.critters, dispatch]);

  /**
   * Per-item selection predicate passed to AssetGrid.
   * Compares each item against the correct state field for its layer type,
   * fixing the hand-rig / clothing checkmark bug (Devin BUG_0006).
   */
  const getIsSelected = useCallback((item: CosmeticItem): boolean => {
    switch (activeTab) {
      case 'Frame':
        return item.id === state.frameId;
      case 'Background':
        return item.id === state.backgroundId;
      case 'Avatar': {
        if (item.layerType === 'avatar_body') return item.id === state.avatarConfig.silhouetteId;
        if (item.layerType === 'avatar_hand') return item.id === state.avatarConfig.handRigId;
        if (item.layerType === 'avatar_clothing') return item.id === state.avatarConfig.clothingId;
        return false;
      }
      case 'Companion':
        return state.critters.some((c) => c.critterId === item.id);
      case 'Landscape':
        return item.id === state.landscapeConfig.landscapeId;
    }
  }, [activeTab, state]);

  /**
   * Save handler — awaits onSave resolution before marking state clean.
   * If onSave is not provided (e.g. guest mode), state is NOT marked clean
   * so users keep their dirty reminder. (Fixes Devin BUG_0001.)
   */
  const handleSave = useCallback(async () => {
    if (!onSave) {
      console.warn('[InspectorDrawer] onSave is not provided; skipping save');
      return;
    }
    setIsSaving(true);
    try {
      await onSave();
      // Only mark clean after a successful save
      dispatch({ type: 'MARK_CLEAN' });
    } catch (err) {
      // Save failed — keep isDirty true so the user knows to retry
      console.error('[InspectorDrawer] Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, dispatch]);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <aside
        aria-label="Customization inspector"
        className={clsx(
          'flex flex-col bg-slate-900',
          'md:relative md:w-80 md:shrink-0 md:translate-x-0 md:border-l md:border-slate-700',
          'fixed bottom-0 left-0 right-0 z-40 max-h-[75vh] rounded-t-2xl',
          'transform transition-transform duration-300 ease-in-out md:transform-none',
          mobileOpen ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center py-2 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-slate-600" />
        </div>

        <TabStrip activeTab={activeTab} isDirty={state.isDirty} onSelect={setActiveTab} />

        <div
          className="flex-1 overflow-y-auto py-3"
          role="tabpanel"
          aria-label={`${activeTab} assets`}
        >
          <AssetGrid
            items={filteredItems}
            getIsSelected={getIsSelected}
            onSelect={handleSelect}
          />

          {activeTab === 'Avatar' && (
            <div className="mt-4 border-t border-slate-700 pt-4">
              <TintPicker
                value={state.avatarConfig.tintColor}
                onChange={handleTintChange}
                label="Avatar Tint"
              />
            </div>
          )}

          {activeTab === 'Companion' && state.critters.length > 0 && (
            <div className="mt-4 border-t border-slate-700 pt-4 px-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Equipped Companions &amp; Perch Sockets
              </h4>
              <div className="flex flex-col gap-2">
                {state.critters.map((critter) => {
                  const item = state.catalogIndex[critter.critterId];
                  return (
                    <div
                      key={critter.critterId}
                      className="flex items-center justify-between rounded-md bg-slate-800/80 px-2.5 py-1.5 border border-slate-700/60 text-xs"
                    >
                      <span className="font-medium text-slate-200 truncate max-w-[120px]">
                        {item?.name ?? 'Companion'}
                      </span>
                      <div className="flex items-center gap-1">
                        <label htmlFor={`perch-${critter.critterId}`} className="sr-only">
                          Perch position
                        </label>
                        <select
                          id={`perch-${critter.critterId}`}
                          value={critter.perchLocation}
                          onChange={(e) =>
                            handlePerchChange(
                              critter.critterId,
                              e.target.value as CritterPerchLocation,
                            )
                          }
                          className="rounded bg-slate-900 border border-slate-700 text-xs text-indigo-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="shoulder">Shoulder</option>
                          <option value="hover">Hover</option>
                          <option value="ground">Ground</option>
                          <option value="pocket">Pocket</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <SaveFAB isDirty={state.isDirty} isSaving={isSaving} onSave={handleSave} />
      </aside>
    </>
  );
};
