/**
 * @module utils/exportBadge
 *
 * Flattens and exports avatar compositions to 128×128 and 512×512 WebP badges
 * for universal SunShade Hub profile integration and cross-game avatar propagation.
 */

import type Konva from 'konva';

export interface BadgeExportOptions {
  mimeType?: 'image/webp' | 'image/png';
  quality?: number;
}

export interface BadgeExportResult {
  dataUrl128: string;
  dataUrl512: string;
  blob128: Blob;
  blob512: Blob;
}

/**
 * Resamples an HTMLCanvasElement into a high-quality square destination canvas.
 */
function resampleCanvas(source: HTMLCanvasElement, targetSize: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, targetSize, targetSize);
  }
  return canvas;
}

/**
 * Converts an HTMLCanvasElement to a binary Blob.
 */
function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert canvas to blob'));
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Generates flattened 128×128 and 512×512 WebP badges from the Konva Stage.
 */
export async function exportAvatarBadges(
  stage: Konva.Stage,
  options: BadgeExportOptions = {},
): Promise<BadgeExportResult> {
  const mimeType = options.mimeType ?? 'image/webp';
  const quality = options.quality ?? 0.95;

  // Capture stage at 2x pixel ratio for maximum fidelity
  const nativeCanvas = stage.toCanvas({ pixelRatio: 2 });

  const canvas128 = resampleCanvas(nativeCanvas, 128);
  const canvas512 = resampleCanvas(nativeCanvas, 512);

  const dataUrl128 = canvas128.toDataURL(mimeType, quality);
  const dataUrl512 = canvas512.toDataURL(mimeType, quality);

  const [blob128, blob512] = await Promise.all([
    canvasToBlob(canvas128, mimeType, quality),
    canvasToBlob(canvas512, mimeType, quality),
  ]);

  return {
    dataUrl128,
    dataUrl512,
    blob128,
    blob512,
  };
}

/**
 * Triggers a user download for a generated badge Blob.
 */
export function downloadBadgeBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
