import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  createAnonymousImage,
  loadImage,
  clearImageCache,
} from '../src/utils/imageLoader';
import {
  safeCanvasToDataURL,
  safeCanvasToBlob,
  exportAvatarBadges,
  createSanitizedFallbackCanvas,
} from '../src/utils/exportBadge';

describe('TASK-AVATAR-CANVAS-ANONYMOUS-CORS: Anonymous CORS and Tainted Canvas Guards', () => {
  beforeEach(() => {
    clearImageCache();
  });

  describe('Image Preloaders', () => {
    it('enforces crossOrigin = anonymous on createAnonymousImage', () => {
      const img = createAnonymousImage();
      expect(img.crossOrigin).toBe('anonymous');
    });

    it('sets crossOrigin = anonymous prior to assigning img.src in loadImage', async () => {
      let crossOriginAtSrcAssignment = '';
      const originalImage = global.Image;

      try {
        (global as any).Image = class MockImage {
          _crossOrigin = '';
          _src = '';
          complete = false;
          naturalWidth = 0;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;

          get crossOrigin() {
            return this._crossOrigin;
          }
          set crossOrigin(val: string) {
            this._crossOrigin = val;
          }

          get src() {
            return this._src;
          }
          set src(val: string) {
            crossOriginAtSrcAssignment = this._crossOrigin;
            this._src = val;
            setTimeout(() => {
              this.complete = true;
              this.naturalWidth = 128;
              this.onload?.();
            }, 5);
          }
        };

        const testUrl = 'https://assets.sunshade.icu/kenney/modular-characters/eyes/focused_green.png';
        const img = await loadImage(testUrl);

        expect(crossOriginAtSrcAssignment).toBe('anonymous');
        expect(img.crossOrigin).toBe('anonymous');
      } finally {
        global.Image = originalImage;
      }
    });
  });

  describe('Canvas Tainting Fallback & Recovery', () => {
    it('creates a sanitized fallback canvas without throwing', () => {
      const fallback = createSanitizedFallbackCanvas(128, 128);
      expect(fallback).toBeDefined();
      expect(fallback.width).toBe(128);
      expect(fallback.height).toBe(128);
    });

    it('safeCanvasToDataURL catches SecurityError and recovers gracefully', () => {
      const mockTaintedCanvas = {
        width: 128,
        height: 128,
        toDataURL: jest.fn().mockImplementation(() => {
          const err = new Error(
            "Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported"
          );
          err.name = 'SecurityError';
          throw err;
        }),
      } as unknown as HTMLCanvasElement;

      // Without allowFallback, throws to protect save integrity
      expect(() => safeCanvasToDataURL(mockTaintedCanvas, 'image/png')).toThrow(
        'Tainted canvases may not be exported'
      );

      // With allowFallback=true, returns sanitized fallback dataUrl for downloads
      const result = safeCanvasToDataURL(mockTaintedCanvas, 'image/png', 0.95, true);
      expect(typeof result).toBe('string');
      expect(result.startsWith('data:')).toBe(true);
    });

    it('safeCanvasToBlob rejects on SecurityError unless allowFallback is true', async () => {
      const mockTaintedCanvas = {
        width: 128,
        height: 128,
        toBlob: jest.fn().mockImplementation(() => {
          const err = new Error(
            "Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported"
          );
          err.name = 'SecurityError';
          throw err;
        }),
      } as unknown as HTMLCanvasElement;

      // Without allowFallback, rejects to protect save integrity
      await expect(safeCanvasToBlob(mockTaintedCanvas, 'image/png')).rejects.toThrow(
        'Tainted canvases may not be exported'
      );

      // With allowFallback=true, returns sanitized fallback blob for downloads
      const blob = await safeCanvasToBlob(mockTaintedCanvas, 'image/png', 0.95, true);
      expect(blob).toBeDefined();
      expect(blob.size).toBeGreaterThanOrEqual(0);
    });

    it('exportAvatarBadges recovers cleanly when stage.toCanvas throws tainted error', async () => {
      const mockStage = {
        width: () => 512,
        height: () => 512,
        scaleX: () => 1,
        scaleY: () => 1,
        x: () => 0,
        y: () => 0,
        scale: jest.fn(),
        position: jest.fn(),
        batchDraw: jest.fn(),
        toCanvas: jest.fn().mockImplementation(() => {
          const err = new Error('Tainted canvases may not be exported');
          err.name = 'SecurityError';
          throw err;
        }),
      } as any;

      // Without allowFallbackOnTainted, exportAvatarBadges rejects to protect saved profile data
      await expect(exportAvatarBadges(mockStage)).rejects.toThrow('Failed to export avatar canvas');

      // With allowFallbackOnTainted, recovers cleanly and produces downloadable badges
      const result = await exportAvatarBadges(mockStage, { allowFallbackOnTainted: true });
      expect(result.dataUrl128).toBeDefined();
      expect(result.dataUrl512).toBeDefined();
      expect(result.blob128).toBeDefined();
      expect(result.blob512).toBeDefined();
    });
  });
});
