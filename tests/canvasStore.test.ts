/**
 * @module tests/canvasStore.test
 *
 * Unit tests for canvasStore reducer, loadout restoration, and anchor clamping.
 */

import { describe, it, expect } from '@jest/globals';
import { canvasReducer, defaultCanvasState } from '../src/store/canvasStore';
import { AnchorCoordinatesSchema } from '../src/schemas/avatar';

describe('canvasStore reducer', () => {
  it('updates landscape with clamped anchor coordinates', () => {
    const updated = canvasReducer(defaultCanvasState, {
      type: 'SET_LANDSCAPE',
      config: {
        anchorCoordinates: { x: 1.5, y: -0.2 },
      },
    });

    expect(updated.landscapeConfig.anchorCoordinates).toEqual({ x: 1, y: 0 });
    expect(updated.isDirty).toBe(true);
  });

  it('restores saved loadout cleanly without remaining dirty', () => {
    const dirtyState = { ...defaultCanvasState, isDirty: true, frameId: 'temp' };

    const restored = canvasReducer(dirtyState, {
      type: 'LOAD_SAVED_LOADOUT',
      loadout: {
        frameId: 'saved-frame-1',
        backgroundId: 'saved-bg-1',
        critters: [{ critterId: 'critter-1', perchLocation: 'shoulder' }],
      },
    });

    expect(restored.frameId).toBe('saved-frame-1');
    expect(restored.backgroundId).toBe('saved-bg-1');
    expect(restored.critters).toHaveLength(1);
    expect(restored.isDirty).toBe(false);
  });

  it('resets loadout on sign out while preserving catalogIndex', () => {
    const stateWithCatalog = {
      ...defaultCanvasState,
      frameId: 'equipped-frame',
      isDirty: true,
      catalogIndex: {
        item1: {
          id: 'item1',
          layerType: 'frame' as const,
          name: 'Item 1',
          assetUrl: 'https://example.com/asset.png',
          rarity: 'standard' as const,
          metadata: {},
        },
      },
    };

    const reset = canvasReducer(stateWithCatalog, { type: 'RESET_LOADOUT' });
    expect(reset.frameId).toBe('');
    expect(reset.isDirty).toBe(false);
    expect(reset.catalogIndex.item1).toBeDefined();
  });
});

describe('AnchorCoordinatesSchema', () => {
  it('accepts coordinates within [0, 1]', () => {
    const valid = AnchorCoordinatesSchema.safeParse({ x: 0.5, y: 0.75 });
    expect(valid.success).toBe(true);
  });

  it('rejects coordinates outside [0, 1]', () => {
    const invalidHigh = AnchorCoordinatesSchema.safeParse({ x: 1.2, y: 0.5 });
    expect(invalidHigh.success).toBe(false);

    const invalidLow = AnchorCoordinatesSchema.safeParse({ x: 0.5, y: -0.1 });
    expect(invalidLow.success).toBe(false);
  });
});
