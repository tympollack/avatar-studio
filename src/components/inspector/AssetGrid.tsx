/**
 * @module components/inspector/AssetGrid
 *
 * Asset selector grid for the inspector drawer.
 *
 * Renders a scrollable grid of thumbnail cards. Each card shows:
 *   - Thumbnail image (or letter placeholder if no assetUrl)
 *   - Item name
 *   - Rarity-colored border ring
 *   - Active checkmark overlay when selected
 *
 * Selection state: each card's selected state is determined by the
 * `getIsSelected` callback, which the parent computes per-item based on
 * layer type (e.g. body cards compare against silhouetteId, hand-rig cards
 * against handRigId). This avoids the single-selectedId bug where hand-rig
 * selections never showed a checkmark.
 *
 * Performance note: `contentVisibility: auto` is a CSS rendering hint that
 * allows the browser to skip paint/layout for off-screen grid rows. It is NOT
 * JavaScript window-based virtualization — for catalogs > ~300 items, replace
 * with @tanstack/react-virtual or react-window for true DOM windowing.
 */

import type React from 'react';
import { clsx } from 'clsx';
import type { CosmeticItem, CosmeticRarity } from '../../types/avatar';

// ──────────────────────────────────────────────
// Rarity border palette
// ──────────────────────────────────────────────

const RARITY_RING: Record<CosmeticRarity, string> = {
  standard: 'ring-slate-600',
  uncommon: 'ring-green-500',
  rare: 'ring-blue-500',
  epic: 'ring-purple-500',
  legendary: 'ring-amber-400',
};

const RARITY_GLOW: Record<CosmeticRarity, string> = {
  standard: '',
  uncommon: 'shadow-[0_0_6px_rgba(34,197,94,0.5)]',
  rare: 'shadow-[0_0_6px_rgba(59,130,246,0.5)]',
  epic: 'shadow-[0_0_8px_rgba(168,85,247,0.6)]',
  legendary: 'shadow-[0_0_10px_rgba(251,191,36,0.7)]',
};

// ──────────────────────────────────────────────
// Single card
// ──────────────────────────────────────────────

interface AssetCardProps {
  item: CosmeticItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const AssetCard: React.FC<AssetCardProps> = ({ item, isSelected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(item.id)}
    aria-pressed={isSelected}
    aria-label={`Select ${item.name}`}
    className={clsx(
      'relative flex flex-col items-center gap-1 rounded-lg p-1.5',
      'bg-slate-800 transition-all duration-150',
      'ring-2',
      RARITY_RING[item.rarity],
      RARITY_GLOW[item.rarity],
      isSelected
        ? 'ring-offset-2 ring-offset-slate-900 scale-105'
        : 'hover:bg-slate-700',
    )}
  >
    {/* Thumbnail */}
    <div className="relative h-14 w-14 overflow-hidden rounded-md bg-slate-900">
      {item.assetUrl ? (
        <img
          src={item.assetUrl}
          alt={item.name}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xl font-bold text-slate-500">
          {item.name.charAt(0).toUpperCase()}
        </span>
      )}

      {/* Active checkmark */}
      {isSelected && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-indigo-600/70">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-6 w-6 text-white"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </div>

    {/* Label */}
    <span className="max-w-full truncate text-center text-[10px] leading-tight text-slate-300">
      {item.name}
    </span>
  </button>
);

// ──────────────────────────────────────────────
// Grid
// ──────────────────────────────────────────────

interface AssetGridProps {
  items: CosmeticItem[];
  /**
   * Per-item selection predicate. Called for each card to determine whether
   * it should show the active checkmark. Replaces the single `selectedId`
   * prop so that mixed-layer grids (e.g. Avatar: body + hand-rig + clothing)
   * can independently track selection per layer type.
   */
  getIsSelected: (item: CosmeticItem) => boolean;
  onSelect: (id: string) => void;
}

export const AssetGrid: React.FC<AssetGridProps> = ({ items, getIsSelected, onSelect }) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-slate-500">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-10 w-10 opacity-40"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 9.75h16.5M3.75 14.25h16.5M9 3.75v16.5M15 3.75v16.5"
          />
        </svg>
        <p className="text-sm">No items in this category</p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-3 gap-2 overflow-y-auto px-2 pb-4"
      style={{ contentVisibility: 'auto' } as React.CSSProperties}
      role="listbox"
      aria-label="Asset selector"
    >
      {items.map((item) => {
        const isSelected = getIsSelected(item);
        return (
          <div key={item.id} role="option" aria-selected={isSelected}>
            <AssetCard
              item={item}
              isSelected={isSelected}
              onSelect={onSelect}
            />
          </div>
        );
      })}
    </div>
  );
};
