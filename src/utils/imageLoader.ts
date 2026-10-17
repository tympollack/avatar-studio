/**
 * @module utils/imageLoader
 *
 * Safe image loading and preloading utilities for HTML5 Canvas and Konva Stage.
 * Strictly enforces `crossOrigin = 'anonymous'` on all HTMLImageElement instances
 * prior to assigning `src` to prevent canvas tainting during export and badge generation.
 */

const imageCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement>>();

/**
 * Creates an HTMLImageElement configured with crossOrigin = 'anonymous'.
 */
export function createAnonymousImage(): HTMLImageElement {
  const ImageConstructor =
    typeof window !== 'undefined' && window.Image
      ? window.Image
      : (globalThis as unknown as { Image: new () => HTMLImageElement }).Image;

  if (!ImageConstructor) {
    return {
      crossOrigin: 'anonymous',
      complete: true,
      naturalWidth: 128,
      naturalHeight: 128,
      src: '',
    } as HTMLImageElement;
  }

  const img = new ImageConstructor();
  // Enforce crossOrigin = 'anonymous' BEFORE src assignment
  img.crossOrigin = 'anonymous';
  return img;
}

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
 * Loads an image URL into memory with crossOrigin = 'anonymous' and resolves with
 * the loaded HTMLImageElement. De-duplicates in-flight requests for the same URL.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = getCachedImage(url);
  if (cached) return Promise.resolve(cached);

  const existingPromise = loadingPromises.get(url);
  if (existingPromise) return existingPromise;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = createAnonymousImage();

    // Verify crossOrigin is explicitly set before assigning src
    if (!img.crossOrigin) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      imageCache.set(url, img);
      loadingPromises.delete(url);
      resolve(img);
    };

    img.onerror = () => {
      loadingPromises.delete(url);
      reject(new Error(`Failed to load asset image: ${url}`));
    };

    // Assign src strictly after crossOrigin is set
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
