/**
 * @module components/inspector/InspectorDrawer
 *
 * Drawer-based customization inspector panel.
 *
 * Renders the five-category switcher bar [Frame | Background | Avatar | Companion | Landscape]
 * and the corresponding virtualized asset grid + tint picker for tintable categories.
 *
 * Mobile behaviour (< 768px): drawer slides up from the bottom and collapses
 * to a tab bar. Desktop: fixed right-side panel (320px wide).
 *
 * Unsaved-changes tracker: shows a yellow dot badge and sticky "Save & Pre-Render" FAB
 * when state.isDirty === true.
 */

import type React from 'react';
import { clsx } from 'clsx';
import { useCanvasStore } from '../../store/canvasStore';
import { INSPECTOR_TABS, useInspectorTabs } from './useInspectorTabs';
import type { InspectorTab } from './useInspectorTabs';
import { AssetGrid } from './AssetGrid';
import { TintPicker } from './TintPicker';
import type { CosmeticItem, CosmeticLayerType } from '../../types/avatar';

// ──────────────────────────────────────────────
// Tab → layer type mapping
// ──────────────────────────────────────────────

const TAB_LAYER_TYPES: Record<InspectorTab, CosmeticLayerType[]> = {
  Frame: ['frame'],
  Background: ['background'],
  Avatar: ['avatar_body', 'avatar_hand'],
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
  onSave: () => void;
}

const SaveFAB: React.FC<SaveFABProps> = ({ isDirty, onSave }) => {
  if (!isDirty) return null;

  return (
    <div className="sticky bottom-0 shrink-0 border-t border-slate-700 bg-slate-900 p-3">
      <button
        type="button"
        onClick={onSave}
        className={clsx(
          'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5',
          'bg-indigo-600 text-sm font-semibold text-white',
          'hover:bg-indigo-500 active:scale-95 transition-all duration-150',
          'shadow-lg shadow-indigo-900/50',
        )}
      >
        <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
        Save &amp; Pre-Render
      </button>
    </div>
  );
};

// ──────────────────────────────────────────────
// Main Drawer
// ──────────────────────────────────────────────

interface InspectorDrawerProps {
  /** Called when user confirms "Save & Pre-Render". No-op by default. */
  onSave?: () => void;
  /** Collapsed on mobile — controlled by parent if desired. */
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

  // ── Catalog filtering ─────────────────────
  const layerTypes = TAB_LAYER_TYPES[activeTab];
  const filteredItems: CosmeticItem[] = Object.values(state.catalogIndex).filter(
    (item) => layerTypes.includes(item.layerType),
  );

  // ── Selection handler ─────────────────────
  const handleSelect = (id: string) => {
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
        }
        break;
      }
      case 'Companion': {
        // Toggle first critter with selected id, or add new
        const existing = state.critters.find((c) => c.critterId === id);
        if (existing) {
          dispatch({
            type: 'SET_CRITTERS',
            critters: state.critters.filter((c) => c.critterId !== id),
          });
        } else {
          dispatch({
            type: 'SET_CRITTERS',
            critters: [
              ...state.critters,
              { critterId: id, perchLocation: 'shoulder' },
            ],
          });
        }
        break;
      }
      case 'Landscape':
        dispatch({ type: 'SET_LANDSCAPE', config: { landscapeId: id } });
        break;
    }
  };

  // ── Tint handler (Avatar only) ─────────────
  const handleTintChange = (hex: string | undefined) => {
    dispatch({ type: 'SET_AVATAR_CONFIG', config: { tintColor: hex } });
  };

  // ── Active selection ID ────────────────────
  const activeId = (() => {
    switch (activeTab) {
      case 'Frame': return state.frameId || undefined;
      case 'Background': return state.backgroundId || undefined;
      case 'Avatar': return state.avatarConfig.silhouetteId || undefined;
      case 'Companion': return state.critters[0]?.critterId;
      case 'Landscape': return state.landscapeConfig.landscapeId || undefined;
    }
  })();

  const handleSave = () => {
    dispatch({ type: 'MARK_CLEAN' });
    onSave?.();
  };

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
          // Layout
          'flex flex-col bg-slate-900',
          // Desktop: fixed right panel
          'md:relative md:w-80 md:shrink-0 md:translate-x-0 md:border-l md:border-slate-700',
          // Mobile: slide-up bottom drawer
          'fixed bottom-0 left-0 right-0 z-40 max-h-[75vh] rounded-t-2xl',
          'transform transition-transform duration-300 ease-in-out md:transform-none',
          mobileOpen ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center py-2 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-slate-600" />
        </div>

        {/* Tab strip */}
        <TabStrip
          activeTab={activeTab}
          isDirty={state.isDirty}
          onSelect={setActiveTab}
        />

        {/* Asset grid */}
        <div
          className="flex-1 overflow-y-auto py-3"
          role="tabpanel"
          aria-label={`${activeTab} assets`}
        >
          <AssetGrid
            items={filteredItems}
            selectedId={activeId}
            onSelect={handleSelect}
          />

          {/* Tint picker — Avatar tab only */}
          {activeTab === 'Avatar' && (
            <div className="mt-4 border-t border-slate-700 pt-4">
              <TintPicker
                value={state.avatarConfig.tintColor}
                onChange={handleTintChange}
                label="Avatar Tint"
              />
            </div>
          )}
        </div>

        {/* Save FAB */}
        <SaveFAB isDirty={state.isDirty} onSave={handleSave} />
      </aside>
    </>
  );
};
