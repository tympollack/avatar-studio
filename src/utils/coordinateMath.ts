/**
 * @module utils/coordinateMath
 *
 * Normalized coordinate utilities for 2.5D habitat anchor placement.
 *
 * The canvas uses a 1024×1024 virtual coordinate space. All landscape
 * props and critter perch sockets are defined in normalized (0.0–1.0)
 * coordinates and converted to canvas-pixel space at render time so that
 * positions remain stable across viewport scaling and device pixel ratios.
 *
 * Perch Socket Definitions
 * ─────────────────────────
 *   shoulder  — rides on the avatar's left shoulder (upper-left quadrant)
 *   pocket    — nestles into a coat/jacket breast pocket (mid-left)
 *   hover     — floats above & behind the avatar head (upper-center)
 *   ground    — sits on the habitat floor in front of the avatar's feet
 */

import type { CritterPerchLocation } from '../types/avatar';

/** Virtual canvas dimensions (pixels). */
export const VIRTUAL_CANVAS_SIZE = 1024;

/** Normalized anchor coordinates (0.0–1.0 in each axis). */
export interface NormalizedCoord {
  x: number;
  y: number;
}

/** Pixel-space coordinate resolved against the current canvas size. */
export interface PixelCoord {
  x: number;
  y: number;
}

/**
 * Converts a normalized (0.0–1.0) coordinate pair into canvas pixel space.
 *
 * @param normalized - Normalized coordinate in [0, 1] range.
 * @param canvasSize - Actual rendered canvas size in pixels (square).
 */
export function normalizedToPixel(
  normalized: NormalizedCoord,
  canvasSize: number,
): PixelCoord {
  return {
    x: normalized.x * canvasSize,
    y: normalized.y * canvasSize,
  };
}

/**
 * Converts a pixel coordinate back to normalized space.
 *
 * @param pixel - Pixel coordinate within the canvas.
 * @param canvasSize - Actual rendered canvas size in pixels (square).
 */
export function pixelToNormalized(pixel: PixelCoord, canvasSize: number): NormalizedCoord {
  return {
    x: pixel.x / canvasSize,
    y: pixel.y / canvasSize,
  };
}

/**
 * Pre-defined avatar perch socket positions in normalized coordinate space.
 * These are tuned for a centered, full-height avatar silhouette occupying
 * roughly the middle 50% of the 1024×1024 virtual canvas.
 *
 * Fine-tune per-landscape via `LandscapeConfig.anchorCoordinates` offsets.
 */
export const PERCH_SOCKETS: Record<CritterPerchLocation, NormalizedCoord> = {
  /** Left shoulder — upper-left of avatar bounding box. */
  shoulder: { x: 0.34, y: 0.28 },
  /** Breast pocket — mid-left of torso. */
  pocket: { x: 0.36, y: 0.45 },
  /** Hovering thruster — floats above avatar head. */
  hover: { x: 0.50, y: 0.14 },
  /** Ground offset — floor level slightly in front of avatar feet. */
  ground: { x: 0.58, y: 0.82 },
};

/**
 * Returns the canvas-pixel perch position for a critter, accounting for
 * the avatar's current anchor offset within the landscape.
 *
 * @param perch        - Critter perch socket type.
 * @param anchorOffset - Landscape-specific anchor offset in normalized space.
 * @param canvasSize   - Rendered canvas size in pixels.
 */
export function resolvePerchPixel(
  perch: CritterPerchLocation,
  anchorOffset: NormalizedCoord,
  canvasSize: number,
): PixelCoord {
  const socket = PERCH_SOCKETS[perch];
  const offsetX = (anchorOffset.x - 0.5) * canvasSize;
  const offsetY = (anchorOffset.y - 0.75) * canvasSize;
  return {
    x: socket.x * canvasSize + offsetX,
    y: socket.y * canvasSize + offsetY,
  };
}

/**
 * Clamps a normalized coordinate to the valid [0, 1] range.
 */
export function clampNormalized(coord: NormalizedCoord): NormalizedCoord {
  return {
    x: Math.max(0, Math.min(1, coord.x)),
    y: Math.max(0, Math.min(1, coord.y)),
  };
}
