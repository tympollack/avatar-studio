/**
 * @module utils/imageCache
 *
 * In-memory HTMLImageElement cache for preloading and canvas stage synchronization.
 * Backed by utils/imageLoader with strict crossOrigin = 'anonymous' enforcement.
 */

export {
  createAnonymousImage,
  getCachedImage,
  loadImage,
  preloadImages,
  clearImageCache,
} from './imageLoader';
