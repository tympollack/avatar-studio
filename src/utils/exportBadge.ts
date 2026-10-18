/**
 * @module utils/exportBadge
 *
 * Flattens and exports avatar compositions to 128×128 and 512×512 WebP badges
 * for universal SunShade Hub profile integration and cross-game avatar propagation.
 *
 * Enforces canvas error guards and try/catch error boundaries to gracefully handle
 * and recover from canvas tainting (DOMException: Tainted canvases may not be exported).
 */

import type Konva from 'konva';

export interface BadgeExportOptions {
  mimeType?: 'image/webp' | 'image/png';
  quality?: number;
  allowFallbackOnTainted?: boolean;
}

export interface BadgeExportResult {
  dataUrl128: string;
  dataUrl512: string;
  blob128: Blob;
  blob512: Blob;
}

/**
 * Creates a clean, untainted fallback canvas rendering a neutral avatar silhouette
 * when external assets fail CORS and taint the primary canvas context.
 */
export function createSanitizedFallbackCanvas(width = 512, height = 512): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    return {
      width,
      height,
      toDataURL: (mime = 'image/webp') => `data:${mime};base64,fallbackSanitizedCanvas`,
      toBlob: (cb: (b: Blob | null) => void, mime = 'image/webp') => {
        const BlobConstructor = typeof Blob !== 'undefined' ? Blob : (globalThis as any).Blob;
        const blob = BlobConstructor ? new BlobConstructor(['fallback'], { type: mime }) : ({ size: 8, type: mime } as Blob);
        cb(blob);
      },
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Background
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#1e293b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle border / frame outline
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
  ctx.lineWidth = Math.max(2, Math.round(width * 0.015));
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);

  // Neutral Avatar Silhouette
  ctx.fillStyle = '#334155';
  // Head
  const headRadius = width * 0.16;
  const centerX = width * 0.5;
  const headCenterY = height * 0.38;
  ctx.beginPath();
  ctx.arc(centerX, headCenterY, headRadius, 0, Math.PI * 2);
  ctx.fill();

  // Shoulders / torso
  const shoulderY = headCenterY + headRadius * 1.3;
  ctx.beginPath();
  ctx.ellipse(centerX, shoulderY + height * 0.25, width * 0.28, height * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/**
 * Safely converts an HTMLCanvasElement to a Data URL, catching any SecurityError (tainted canvas).
 * Only returns a sanitized fallback badge when `allowFallback` is explicitly true (e.g. for user downloads).
 */
export function safeCanvasToDataURL(
  canvas: HTMLCanvasElement,
  mimeType = 'image/webp',
  quality = 0.95,
  allowFallback = false
): string {
  try {
    return canvas.toDataURL(mimeType, quality);
  } catch (err: unknown) {
    const error = err as Error;
    if (
      allowFallback &&
      (error.name === 'SecurityError' ||
        error.message?.includes('Tainted canvases') ||
        error.message?.includes('tainted'))
    ) {
      console.warn(
        '[exportBadge] Canvas tainted by cross-origin assets during toDataURL. Rendering untainted fallback badge:',
        error.message
      );
      const fallback = createSanitizedFallbackCanvas(canvas.width, canvas.height);
      return fallback.toDataURL(mimeType, quality);
    }
    throw err;
  }
}

/**
 * Safely converts an HTMLCanvasElement to a binary Blob, catching any SecurityError (tainted canvas).
 * Only returns a sanitized fallback blob when `allowFallback` is explicitly true (e.g. for user downloads).
 */
export function safeCanvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType = 'image/webp',
  quality = 0.95,
  allowFallback = false
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else if (allowFallback) {
            console.warn('[exportBadge] canvas.toBlob returned null, generating fallback blob');
            const fallback = createSanitizedFallbackCanvas(canvas.width, canvas.height);
            fallback.toBlob(
              (fb) => (fb ? resolve(fb) : reject(new Error('Failed to generate fallback blob'))),
              mimeType,
              quality
            );
          } else {
            reject(new Error('Failed to serialize canvas to blob: canvas.toBlob returned null'));
          }
        },
        mimeType,
        quality
      );
    } catch (err: unknown) {
      const error = err as Error;
      if (
        allowFallback &&
        (error.name === 'SecurityError' ||
          error.message?.includes('Tainted canvases') ||
          error.message?.includes('tainted'))
      ) {
        console.warn(
          '[exportBadge] Canvas tainted by cross-origin assets during toBlob. Rendering untainted fallback badge:',
          error.message
        );
        const fallback = createSanitizedFallbackCanvas(canvas.width, canvas.height);
        fallback.toBlob(
          (fallbackBlob) => {
            if (fallbackBlob) resolve(fallbackBlob);
            else reject(new Error('Failed to generate sanitized fallback blob'));
          },
          mimeType,
          quality
        );
      } else {
        reject(err);
      }
    }
  });
}

/**
 * Resamples an HTMLCanvasElement into a high-quality square destination canvas.
 * When `allowFallback` is false, propagates errors instead of substituting placeholder canvases.
 */
function resampleCanvas(
  source: HTMLCanvasElement,
  targetSize: number,
  allowFallback = false
): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    if (!allowFallback) {
      throw new Error('Canvas environment unavailable for badge resampling');
    }
    return createSanitizedFallbackCanvas(targetSize, targetSize);
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(source, 0, 0, targetSize, targetSize);
    } catch (err: unknown) {
      const error = err as Error;
      if (!allowFallback) {
        throw new Error(`Failed to resample canvas: ${error.message}`);
      }
      console.warn('[exportBadge] Failed to resample canvas (likely tainted):', error.message);
      return createSanitizedFallbackCanvas(targetSize, targetSize);
    }
  } else if (!allowFallback) {
    throw new Error('Failed to obtain 2D rendering context for badge resampling');
  } else {
    return createSanitizedFallbackCanvas(targetSize, targetSize);
  }
  return canvas;
}

export { preloadImages } from './imageLoader';

/**
 * Waits for React and Konva to commit all expected image nodes to the stage and confirms
 * that every active image bitmap is fully loaded and drawn before canvas export.
 */
function isLoadedImageElement(source: CanvasImageSource | undefined): source is HTMLImageElement {
  if (!source) return false;
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return source.complete && source.naturalWidth > 0;
  }
  const duck = source as { complete?: boolean; naturalWidth?: number; src?: string };
  return Boolean(
    duck.src && duck.complete !== false && (duck.naturalWidth === undefined || duck.naturalWidth > 0)
  );
}

export async function waitForStageReadiness(
  stage: Konva.Stage,
  expectedUrls: string[],
  timeoutMs = 3000
): Promise<void> {
  const validExpected = Array.from(new Set(expectedUrls.filter((url): url is string => Boolean(url))));
  if (validExpected.length === 0) {
    stage.batchDraw();
    return;
  }

  let timerId: ReturnType<typeof setTimeout> | undefined;
  let isDone = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      isDone = true;
      stage.batchDraw();
      reject(
        new Error(
          'Timed out waiting for avatar canvas stage image nodes to commit and draw active assets.'
        )
      );
    }, timeoutMs);
  });

  const pollPromise = new Promise<void>((resolve) => {
    const check = () => {
      if (isDone) return;

      const imageNodes = stage.find('Image') as Konva.Image[];
      const renderedImages = imageNodes.map((node) => node.image()).filter(isLoadedImageElement);

      const renderedSrcs = renderedImages.map((img) => img.src);

      const allPresent = validExpected.every((expected) =>
        renderedSrcs.some((src) => {
          if (src === expected || src.endsWith(expected) || expected.endsWith(src)) {
            return true;
          }
          try {
            const expectedHref = new URL(
              expected,
              typeof window !== 'undefined' ? window.location.href : 'http://localhost'
            ).href;
            return src === expectedHref;
          } catch {
            return false;
          }
        })
      );

      if (allPresent) {
        isDone = true;
        stage.batchDraw();
        resolve();
        return;
      }

      setTimeout(check, 16);
    };

    check();
  });

  try {
    await Promise.race([pollPromise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

/**
 * Generates flattened 128×128 and 512×512 WebP badges from the Konva Stage.
 * Wrapped in error guards to catch and report canvas tainting without crashing.
 */
export async function exportAvatarBadges(
  stage: Konva.Stage,
  options: BadgeExportOptions = {}
): Promise<BadgeExportResult> {
  const mimeType = options.mimeType ?? 'image/webp';
  const quality = options.quality ?? 0.95;

  // Preserve user pan & zoom transforms to capture canonical avatar framing
  const prevScale = { x: stage.scaleX(), y: stage.scaleY() };
  const prevPos = { x: stage.x(), y: stage.y() };

  // Calculate pixel ratio ensuring at least 512px source dimension on any viewport
  const width = Math.max(stage.width(), 1);
  const minRequiredRatio = Math.max(2, Math.ceil(512 / width));

  let nativeCanvas: HTMLCanvasElement;
  try {
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.batchDraw();

    try {
      nativeCanvas = stage.toCanvas({ pixelRatio: minRequiredRatio });
    } catch (canvasErr: unknown) {
      const err = canvasErr as Error;
      if (!options.allowFallbackOnTainted) {
        throw new Error(`Failed to export avatar canvas: ${err.message}`);
      }
      console.warn(
        '[exportBadge] stage.toCanvas() failed (likely cross-origin canvas tainting), using fallback for download:',
        err.message
      );
      nativeCanvas = createSanitizedFallbackCanvas(512, 512);
    }
  } finally {
    // Restore user viewport pan & zoom
    stage.scale(prevScale);
    stage.position(prevPos);
    stage.batchDraw();
  }

  const allowFallback = Boolean(options.allowFallbackOnTainted);

  const canvas128 = resampleCanvas(nativeCanvas, 128, allowFallback);
  const canvas512 = resampleCanvas(nativeCanvas, 512, allowFallback);

  const dataUrl128 = safeCanvasToDataURL(canvas128, mimeType, quality, allowFallback);
  const dataUrl512 = safeCanvasToDataURL(canvas512, mimeType, quality, allowFallback);

  const [blob128, blob512] = await Promise.all([
    safeCanvasToBlob(canvas128, mimeType, quality, allowFallback),
    safeCanvasToBlob(canvas512, mimeType, quality, allowFallback),
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
