import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { waitForStageReadiness } from '../src/utils/exportBadge';
import {
  getCachedImage,
  loadImage,
  preloadImages,
  clearImageCache,
} from '../src/utils/imageCache';

describe('exportBadge and imageCache', () => {
  beforeEach(() => {
    clearImageCache();
  });

  describe('imageCache', () => {
    it('returns null for uncached or empty URL', () => {
      expect(getCachedImage(undefined)).toBeNull();
      expect(getCachedImage('https://assets.sunshade.icu/avatar/base.png')).toBeNull();
    });

    it('preloads images and populates image cache', async () => {
      const originalImage = global.Image;
      try {
        (global as any).Image = class MockImage {
          crossOrigin = '';
          src = '';
          complete = false;
          naturalWidth = 0;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;

          constructor() {
            setTimeout(() => {
              this.complete = true;
              this.naturalWidth = 128;
              this.onload?.();
            }, 5);
          }
        };

        const testUrl = 'https://assets.sunshade.icu/avatar/test-base.png';
        await preloadImages([testUrl]);

        const cached = getCachedImage(testUrl);
        expect(cached).not.toBeNull();
        expect(cached?.complete).toBe(true);
        expect(cached?.naturalWidth).toBe(128);
      } finally {
        global.Image = originalImage;
      }
    });
  });

  describe('waitForStageReadiness', () => {
    it('resolves immediately when expectedUrls is empty', async () => {
      const mockStage = {
        batchDraw: jest.fn(),
        find: jest.fn().mockReturnValue([]),
      } as any;

      await expect(waitForStageReadiness(mockStage, [])).resolves.toBeUndefined();
      expect(mockStage.batchDraw).toHaveBeenCalled();
    });

    it('resolves when all expected URLs are present in stage Image nodes', async () => {
      const mockImg = {
        src: 'https://assets.sunshade.icu/avatar/hat.png',
        complete: true,
        naturalWidth: 128,
      };

      const mockImageNode = {
        image: () => mockImg,
      };

      const mockStage = {
        batchDraw: jest.fn(),
        find: jest.fn().mockReturnValue([mockImageNode]),
      } as any;

      await expect(
        waitForStageReadiness(mockStage, ['https://assets.sunshade.icu/avatar/hat.png'], 500)
      ).resolves.toBeUndefined();

      expect(mockStage.batchDraw).toHaveBeenCalled();
    });

    it('times out and throws if an expected image node never renders', async () => {
      const mockStage = {
        batchDraw: jest.fn(),
        find: jest.fn().mockReturnValue([]),
      } as any;

      await expect(
        waitForStageReadiness(
          mockStage,
          ['https://assets.sunshade.icu/avatar/missing-hat.png'],
          100
        )
      ).rejects.toThrow('Timed out waiting for avatar canvas stage image nodes');
    });
  });
});
