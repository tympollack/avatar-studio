/**
 * @module store/canvasStore
 *
 * Lightweight reactive canvas state store using React context + useReducer.
 * Manages the active cosmetic loadout and tracks unsaved dirty state.
 * No external state library dependency — tree-shakeable and SSR-safe.
 */

import { createContext, useContext } from 'react';
import type {
  AvatarConfig,
  CritterConfig,
  LandscapeConfig,
  LandscapeTheme,
  CosmeticItem,
} from '../types/avatar';

// ──────────────────────────────────────────────
// State Shape
// ──────────────────────────────────────────────

export interface CanvasState {
  /** Active frame asset ID. */
  frameId: string;
  /** Active background asset ID + day/night theme. */
  backgroundId: string;
  backgroundTheme: LandscapeTheme;
  /** Avatar silhouette, hand-rig, clothing, tint. */
  avatarConfig: AvatarConfig;
  /** Ordered list of attached critters. */
  critters: CritterConfig[];
  /** Landscape habitat config. */
  landscapeConfig: LandscapeConfig;
  /** Whether any unsaved changes exist since last save. */
  isDirty: boolean;
  /** Catalog items indexed by their ID for O(1) lookup. */
  catalogIndex: Record<string, CosmeticItem>;
}

export const defaultCanvasState: CanvasState = {
  frameId: '',
  backgroundId: '',
  backgroundTheme: 'day',
  avatarConfig: { silhouetteId: '' },
  critters: [],
  landscapeConfig: {
    landscapeId: '',
    anchorCoordinates: { x: 0.5, y: 0.75 },
    theme: 'day',
  },
  isDirty: false,
  catalogIndex: {},
};

// ──────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────

export type CanvasAction =
  | { type: 'SET_FRAME'; frameId: string }
  | { type: 'SET_BACKGROUND'; backgroundId: string }
  | { type: 'SET_BG_THEME'; theme: LandscapeTheme }
  | { type: 'SET_AVATAR_CONFIG'; config: Partial<AvatarConfig> }
  | { type: 'SET_CRITTERS'; critters: CritterConfig[] }
  | { type: 'SET_LANDSCAPE'; config: Partial<LandscapeConfig> }
  | { type: 'SET_CATALOG'; items: CosmeticItem[] }
  | { type: 'MARK_CLEAN' };

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'SET_FRAME':
      return { ...state, frameId: action.frameId, isDirty: true };
    case 'SET_BACKGROUND':
      return { ...state, backgroundId: action.backgroundId, isDirty: true };
    case 'SET_BG_THEME':
      return {
        ...state,
        backgroundTheme: action.theme,
        landscapeConfig: { ...state.landscapeConfig, theme: action.theme },
        isDirty: true,
      };
    case 'SET_AVATAR_CONFIG':
      return {
        ...state,
        avatarConfig: { ...state.avatarConfig, ...action.config },
        isDirty: true,
      };
    case 'SET_CRITTERS':
      return { ...state, critters: action.critters, isDirty: true };
    case 'SET_LANDSCAPE':
      return {
        ...state,
        landscapeConfig: { ...state.landscapeConfig, ...action.config },
        isDirty: true,
      };
    case 'SET_CATALOG': {
      const catalogIndex: Record<string, CosmeticItem> = {};
      for (const item of action.items) {
        catalogIndex[item.id] = item;
      }
      return { ...state, catalogIndex };
    }
    case 'MARK_CLEAN':
      return { ...state, isDirty: false };
    default:
      return state;
  }
}

// ──────────────────────────────────────────────
// Context
// ──────────────────────────────────────────────

export interface CanvasContextValue {
  state: CanvasState;
  dispatch: React.Dispatch<CanvasAction>;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasStore(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error('useCanvasStore must be used inside <CanvasProvider>');
  }
  return ctx;
}
