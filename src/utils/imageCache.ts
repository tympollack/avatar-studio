/**
 * @module utils/imageCache
 *
 * In-memory HTMLImageElement cache for preloading and canvas stage synchronization.
 * Guarantees that images loaded by preloader are immediately available to useImage
 * synchronously without placeholder flashes, and provides image readiness tracking
 * for Konva stage export operations.
 */

const imageCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement>>();

/**
 * Returns a completed HTMLImageElement from cache, or null if not yet loaded.
 */
export function getCachedImage(url: string | undefined): HTMLImageElement | null {
  if (!url) return null;
  const cached = imageCache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }
  return null;
}

/**
 * Loads an image URL into memory and resolves with the loaded HTMLImageElement.
 * De-duplicates in-flight requests for the same URL.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = getCachedImage(url);
  if (cached) return Promise.resolve(cached);

  const existingPromise = loadingPromises.get(url);
  if (existingPromise) return existingPromise;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const ImageConstructor =
      typeof window !== 'undefined' && window.Image ? window.Image : (globalThis as any).Image;
    if (!ImageConstructor) {
      const fallback = { src: url, complete: true, naturalWidth: 128 } as HTMLImageElement;
      imageCache.set(url, fallback);
      resolve(fallback);
      return;
    }

    const img = new ImageConstructor();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img as HTMLImageElement);
      loadingPromises.delete(url);
      resolve(img as HTMLImageElement);
    };
    img.onerror = () => {
      loadingPromises.delete(url);
      reject(new Error(`Failed to load asset image: ${url}`));
    };
    img.src = url;
  });

  loadingPromises.set(url, promise);
  return promise;
}

/**
 * Preloads all requested URLs into memory cache before canvas capture.
 */
export async function preloadImages(urls: (string | undefined)[]): Promise<HTMLImageElement[]> {
  const validUrls = Array.from(new Set(urls.filter((url): url is string => Boolean(url))));
  return Promise.all(validUrls.map(loadImage));
}

/**
 * Clears the image cache. Primarily used in testing.
 */
export function clearImageCache(): void {
  imageCache.clear();
  loadingPromises.clear();
}
