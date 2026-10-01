/**
 * @module tests/coordinateMath.test
 *
 * Unit tests for src/utils/coordinateMath.ts
 * Validates normalized ↔ pixel conversions, perch socket definitions,
 * clamping, and landscape-offset-aware perch resolution.
 */

import { describe, it, expect } from '@jest/globals';
import {
  normalizedToPixel,
  pixelToNormalized,
  resolvePerchPixel,
  clampNormalized,
  PERCH_SOCKETS,
  VIRTUAL_CANVAS_SIZE,
} from '../src/utils/coordinateMath';

const CANVAS = VIRTUAL_CANVAS_SIZE; // 1024

describe('normalizedToPixel', () => {
  it('maps (0.5, 0.5) to canvas center', () => {
    const result = normalizedToPixel({ x: 0.5, y: 0.5 }, CANVAS);
    expect(result).toEqual({ x: 512, y: 512 });
  });

  it('maps (0, 0) to canvas origin', () => {
    expect(normalizedToPixel({ x: 0, y: 0 }, CANVAS)).toEqual({ x: 0, y: 0 });
  });

  it('maps (1, 1) to canvas far corner', () => {
    expect(normalizedToPixel({ x: 1, y: 1 }, CANVAS)).toEqual({
      x: CANVAS,
      y: CANVAS,
    });
  });

  it('scales correctly for a smaller canvas', () => {
    const result = normalizedToPixel({ x: 0.25, y: 0.75 }, 400);
    expect(result).toEqual({ x: 100, y: 300 });
  });
});

describe('pixelToNormalized', () => {
  it('maps canvas center to (0.5, 0.5)', () => {
    expect(pixelToNormalized({ x: 512, y: 512 }, CANVAS)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it('is the inverse of normalizedToPixel', () => {
    const norm = { x: 0.33, y: 0.67 };
    const pixel = normalizedToPixel(norm, CANVAS);
    const back = pixelToNormalized(pixel, CANVAS);
    expect(back.x).toBeCloseTo(norm.x);
    expect(back.y).toBeCloseTo(norm.y);
  });
});

describe('clampNormalized', () => {
  it('leaves valid coords unchanged', () => {
    expect(clampNormalized({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('clamps values above 1', () => {
    expect(clampNormalized({ x: 1.5, y: 2.0 })).toEqual({ x: 1, y: 1 });
  });

  it('clamps values below 0', () => {
    expect(clampNormalized({ x: -0.3, y: -1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('PERCH_SOCKETS', () => {
  const perches = ['shoulder', 'pocket', 'hover', 'ground'] as const;

  it('defines all four perch types', () => {
    perches.forEach((p) => {
      expect(PERCH_SOCKETS[p]).toBeDefined();
    });
  });

  it('all coordinates are in normalized [0, 1] range', () => {
    perches.forEach((p) => {
      const socket = PERCH_SOCKETS[p];
      expect(socket.x).toBeGreaterThanOrEqual(0);
      expect(socket.x).toBeLessThanOrEqual(1);
      expect(socket.y).toBeGreaterThanOrEqual(0);
      expect(socket.y).toBeLessThanOrEqual(1);
    });
  });

  it('hover perch is positioned above shoulder perch', () => {
    expect(PERCH_SOCKETS.hover.y).toBeLessThan(PERCH_SOCKETS.shoulder.y);
  });

  it('ground perch is positioned below pocket perch', () => {
    expect(PERCH_SOCKETS.ground.y).toBeGreaterThan(PERCH_SOCKETS.pocket.y);
  });
});

describe('resolvePerchPixel', () => {
  const CENTER_ANCHOR = { x: 0.5, y: 0.75 };

  it('returns finite pixel coordinates', () => {
    const result = resolvePerchPixel('shoulder', CENTER_ANCHOR, CANVAS);
    expect(isFinite(result.x)).toBe(true);
    expect(isFinite(result.y)).toBe(true);
  });

  it('shifts position when anchor offset changes', () => {
    const center = resolvePerchPixel('ground', CENTER_ANCHOR, CANVAS);
    const shifted = resolvePerchPixel('ground', { x: 0.6, y: 0.75 }, CANVAS);
    // x should shift rightward
    expect(shifted.x).toBeGreaterThan(center.x);
  });

  it('result differs by perch type', () => {
    const shoulder = resolvePerchPixel('shoulder', CENTER_ANCHOR, CANVAS);
    const ground = resolvePerchPixel('ground', CENTER_ANCHOR, CANVAS);
    expect(ground.y).toBeGreaterThan(shoulder.y);
  });
});
