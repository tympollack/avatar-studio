/**
 * @module components/inspector/AssetThumbnail
 *
 * Resilient asset thumbnail card component for the inspector drawer.
 *
 * Implements:
 * 1. Animated shimmering skeleton placeholder during image loading.
 * 2. Styled Lucide icon fallback corresponding to layer slot on error (User, Eye, Smile, Scissors, etc.)
 *    with a muted border and retry indicator rather than native browser broken-image glyphs.
 * 3. Graceful retry capability to reload failed CDN assets.
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  User,
  Eye,
  Smile,
  Scissors,
  Shirt,
  Crown,
  Sparkles,
  Hand,
  Mountain,
  Shield,
  RotateCcw,
} from 'lucide-react';
import type { CosmeticItem, CosmeticLayerType } from '../../types/avatar';

export interface AssetThumbnailProps {
  item: CosmeticItem;
  className?: string;
}

/**
 * Returns a dedicated Lucide icon component corresponding to the cosmetic layer slot.
 */
export function getSlotIcon(layerType: CosmeticLayerType): React.ComponentType<{ className?: string }> {
  switch (layerType) {
    case 'avatar_body':
    case 'avatar_base':
      return User;
    case 'avatar_eyes':
      return Eye;
    case 'avatar_mouth':
      return Smile;
    case 'avatar_hair':
      return Scissors;
    case 'avatar_clothing':
    case 'avatar_outfit':
      return Shirt;
    case 'avatar_hat':
      return Crown;
    case 'avatar_accessory':
      return Sparkles;
    case 'avatar_hand':
      return Hand;
    case 'critter':
      return Sparkles;
    case 'landscape':
      return Mountain;
    case 'frame':
    case 'avatar_frame':
      return Shield;
    case 'background':
      return Mountain;
    default:
      return User;
  }
}

export const AssetThumbnail: React.FC<AssetThumbnailProps> = ({ item, className }) => {
  const [isLoading, setIsLoading] = useState<boolean>(() => Boolean(item.assetUrl));
  const [hasError, setHasError] = useState<boolean>(false);
  const [retryNonce, setRetryNonce] = useState<number>(0);

  const handleRetry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setHasError(false);
      setIsLoading(true);
      setRetryNonce((prev) => prev + 1);
    },
    []
  );

  const SlotIcon = getSlotIcon(item.layerType);

  // If no asset URL is configured or if network fetch failed
  if (!item.assetUrl || hasError) {
    return (
      <div
        className={clsx(
          'relative flex h-full w-full flex-col items-center justify-center rounded-md',
          'border border-slate-700/60 bg-slate-900/90 text-slate-400 p-1 transition-colors',
          className
        )}
        title={hasError ? `Failed to load ${item.name}. Click to retry.` : item.name}
      >
        <SlotIcon className="h-6 w-6 text-slate-400 opacity-80" />
        {hasError && (
          <button
            type="button"
            onClick={handleRetry}
            aria-label={`Retry loading ${item.name}`}
            className="mt-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="h-2.5 w-2.5 animate-spin-reverse" />
            <span>Retry</span>
          </button>
        )}
      </div>
    );
  }

  // Construct src with retry nonce if retried
  const src = retryNonce > 0 ? `${item.assetUrl}?retry=${retryNonce}` : item.assetUrl;

  return (
    <div className={clsx('relative h-full w-full overflow-hidden rounded-md bg-slate-900', className)}>
      {/* Animated shimmering skeleton loader */}
      {isLoading && (
        <div
          data-testid="thumbnail-skeleton"
          className="absolute inset-0 z-10 animate-pulse bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800"
          aria-hidden="true"
        />
      )}

      <img
        src={src}
        alt={item.name}
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        className={clsx(
          'h-full w-full object-cover transition-opacity duration-200',
          isLoading ? 'opacity-0' : 'opacity-100'
        )}
      />
    </div>
  );
};
