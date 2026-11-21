/**
 * @module utils/assetManifest
 *
 * Multi-layer canvas assembler and R2 asset manifest adapter powered by `@digitalcanopy/assets`.
 *
 * Responsibilities:
 *   1. Consumes `@digitalcanopy/assets` sprite atlas manifests (`modularCharactersAtlas`,
 *      `isometricTilesAtlas`, `uiSpritesAtlas`) and autocomplete key registries.
 *   2. Resolves R2 CDN URLs via `getKenneyCharacterUrl` / `getKenneyAssetUrl` with zero
 *      hardcoded binary assets in the repository.
 *   3. Provides `assembleAvatarLayers` and `buildAvatarCompositeManifest` as a single
 *      deterministic z-order source of truth shared between React-Konva stage rendering
 *      and headless edge pre-rendering.
 */

import {
  KENNEY_CDN_BASE,
  MODULAR_CHARACTERS,
  ISOMETRIC_TILES,
  UI_SPRITES,
  modularCharactersAtlas,
  isometricTilesAtlas,
  uiSpritesAtlas,
  getFrameCoordinates,
  getKenneyAssetUrl,
  getKenneyCharacterUrl,
  type AnchorPoint,
  type AtlasFrame,
  type AtlasManifest,
  type IsometricTileKey,
  type ModularCharacterKey,
  type UiSpriteKey,
} from '@digitalcanopy/assets';
import type {
  AssetLayer,
  AvatarConfig,
  CompositeManifest,
  CosmeticItem,
  CosmeticLayerType,
  CritterConfig,
} from '../types/avatar';
import { VIRTUAL_CANVAS_SIZE, clampNormalized } from './coordinateMath';

export { KENNEY_CDN_BASE };

// ──────────────────────────────────────────────
// Key & Category Parsing
// ──────────────────────────────────────────────

const MODULAR_CATEGORY_LAYER_MAP: Record<string, CosmeticLayerType> = {
  skin: 'avatar_base',
  face: 'avatar_face',
  hair: 'avatar_hair',
  shirts: 'avatar_clothing',
  pants: 'avatar_pants',
  shoes: 'avatar_shoes',
};

const MODULAR_KEY_SET = new Set<string>(MODULAR_CHARACTERS);
const ISOMETRIC_TILE_SET = new Set<string>(ISOMETRIC_TILES);
const UI_SPRITE_SET = new Set<string>(UI_SPRITES);

export interface ParsedModularKey {
  key: ModularCharacterKey;
  category: string;
  itemKey: string;
  layerType: CosmeticLayerType;
  displayName: string;
}

function toTitleCase(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Parses a canonical `@digitalcanopy/assets` `MODULAR_CHARACTERS` key
 * (e.g. `"char-hair-hair-blonde-0"`) into its R2 category, item filename key,
 * normalized `CosmeticLayerType`, and display label.
 */
export function parseModularCharacterKey(key: string): ParsedModularKey | null {
  if (!MODULAR_KEY_SET.has(key)) return null;
  const match = /^char-([a-z]+)-(.+)$/.exec(key);
  if (!match) return null;

  const [, category, itemKey] = match;
  const layerType = MODULAR_CATEGORY_LAYER_MAP[category];
  if (!layerType) return null;

  return {
    key: key as ModularCharacterKey,
    category,
    itemKey,
    layerType,
    displayName: toTitleCase(itemKey),
  };
}

// ──────────────────────────────────────────────
// Manifest-Backed Catalog Builder
// ──────────────────────────────────────────────

function buildAtlasMetadata(
  pack: string,
  manifestKey: string,
  manifest: AtlasManifest,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const atlasFrame = getFrameCoordinates(manifest, manifestKey);
  return {
    pack,
    manifestKey,
    atlasUrl: manifest.meta.image,
    atlasFrame,
    source: '@digitalcanopy/assets',
    license: 'CC0-Kenney',
    ...extra,
  };
}

/**
 * Generates baseline `CosmeticItem` entries directly from `@digitalcanopy/assets`
 * manifests (`MODULAR_CHARACTERS`, `ISOMETRIC_TILES`, and frame-capable `UI_SPRITES`),
 * resolving every asset URL onto the Cloudflare R2 CDN.
 */
export function buildKenneyManifestCatalog(): CosmeticItem[] {
  const items: CosmeticItem[] = [];

  for (const key of MODULAR_CHARACTERS) {
    const parsed = parseModularCharacterKey(key);
    if (!parsed) continue;
    items.push({
      id: key,
      layerType: parsed.layerType,
      name: parsed.displayName,
      assetUrl: getKenneyCharacterUrl(parsed.category, parsed.itemKey, 'png'),
      rarity: 'standard',
      metadata: buildAtlasMetadata('modular-characters', key, modularCharactersAtlas, {
        category: parsed.category,
        itemKey: parsed.itemKey,
      }),
    });
  }

  for (const tileKey of ISOMETRIC_TILES) {
    items.push({
      id: tileKey,
      layerType: 'landscape',
      name: toTitleCase(tileKey.replace(/^tile-isometric-/, '')),
      assetUrl: getKenneyAssetUrl('isometric-tiles', tileKey, 'png'),
      rarity: 'standard',
      metadata: buildAtlasMetadata('isometric-tiles', tileKey, isometricTilesAtlas),
    });
  }

  for (const spriteKey of UI_SPRITES) {
    if (!spriteKey.startsWith('panel-')) continue;
    items.push({
      id: spriteKey,
      layerType: 'avatar_frame',
      name: toTitleCase(spriteKey.replace(/^panel-/, '')),
      assetUrl: getKenneyAssetUrl('ui-pack', spriteKey, 'png'),
      rarity: 'standard',
      metadata: buildAtlasMetadata('ui-pack', spriteKey, uiSpritesAtlas),
    });
  }

  return items;
}

// ──────────────────────────────────────────────
// CDN URL & Atlas Frame Resolution
// ──────────────────────────────────────────────

/**
 * Resolves any catalog item ID, `@digitalcanopy/assets` manifest key, or direct URL
 * to an R2 CDN asset URL.
 */
export function resolveManifestAssetUrl(
  assetIdOrKey: string | undefined | null,
  catalogIndex?: Record<string, CosmeticItem>,
): string | undefined {
  if (!assetIdOrKey) return undefined;

  const directItem = catalogIndex?.[assetIdOrKey];
  if (directItem?.assetUrl) {
    return directItem.assetUrl;
  }

  if (catalogIndex) {
    for (const candidate of Object.values(catalogIndex)) {
      if (
        (candidate.metadata?.manifestKey === assetIdOrKey ||
          candidate.metadata?.asset_key === assetIdOrKey) &&
        candidate.assetUrl
      ) {
        return candidate.assetUrl;
      }
    }
  }

  const parsedModular = parseModularCharacterKey(assetIdOrKey);
  if (parsedModular) {
    return getKenneyCharacterUrl(parsedModular.category, parsedModular.itemKey, 'png');
  }

  if (ISOMETRIC_TILE_SET.has(assetIdOrKey)) {
    return getKenneyAssetUrl('isometric-tiles', assetIdOrKey as IsometricTileKey, 'png');
  }

  if (UI_SPRITE_SET.has(assetIdOrKey)) {
    return getKenneyAssetUrl('ui-pack', assetIdOrKey as UiSpriteKey, 'png');
  }

  if (assetIdOrKey.startsWith('http://') || assetIdOrKey.startsWith('https://')) {
    return assetIdOrKey;
  }

  return undefined;
}

/**
 * Resolves atlas frame metadata for a manifest key or `CosmeticItem` when available.
 */
export function resolveItemAtlasFrame(
  assetIdOrKey: string,
  item?: CosmeticItem,
): AtlasFrame | undefined {
  const metaFrame = item?.metadata?.atlasFrame as AtlasFrame | undefined;
  if (metaFrame?.frame) return metaFrame;

  const manifestKey = (item?.metadata?.manifestKey as string | undefined) || assetIdOrKey;
  if (MODULAR_KEY_SET.has(manifestKey)) {
    return getFrameCoordinates(modularCharactersAtlas, manifestKey);
  }
  if (ISOMETRIC_TILE_SET.has(manifestKey)) {
    return getFrameCoordinates(isometricTilesAtlas, manifestKey);
  }
  if (UI_SPRITE_SET.has(manifestKey)) {
    return getFrameCoordinates(uiSpritesAtlas, manifestKey);
  }
  return undefined;
}

/**
 * Returns Konva crop bounds only when an item explicitly targets a packed sprite-sheet
 * image (`metadata.useAtlasCrop === true` or `assetUrl === metadata.atlasUrl`).
 */
export function resolveSpriteCrop(
  item?: CosmeticItem,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!item) return undefined;
  const atlasFrame = item.metadata?.atlasFrame as AtlasFrame | undefined;
  if (!atlasFrame?.frame || atlasFrame.frame.w <= 0 || atlasFrame.frame.h <= 0) {
    return undefined;
  }

  const usesAtlasSheet =
    item.metadata?.useAtlasCrop === true ||
    (typeof item.metadata?.atlasUrl === 'string' && item.assetUrl === item.metadata.atlasUrl);

  if (!usesAtlasSheet) return undefined;

  return {
    x: atlasFrame.frame.x,
    y: atlasFrame.frame.y,
    width: atlasFrame.frame.w,
    height: atlasFrame.frame.h,
  };
}

// ──────────────────────────────────────────────
// Multi-Layer Canvas Assembler
// ──────────────────────────────────────────────

export type AvatarConfigSlotKey =
  | 'silhouetteId'
  | 'pantsId'
  | 'shoesId'
  | 'clothingId'
  | 'faceId'
  | 'eyesId'
  | 'mouthId'
  | 'hairId'
  | 'hatId'
  | 'accessoryId'
  | 'handRigId';

export interface AvatarLayerSlotSpec {
  slot: AvatarConfigSlotKey;
  layerType: CosmeticLayerType;
  zIndex: number;
  supportsTint?: boolean;
  alwaysEmit?: boolean;
}

/**
 * Deterministic back-to-front layer stack for multi-layer avatar compositing.
 * Matches the Kenney modular character specification plus SunShade accessory slots.
 */
export const AVATAR_LAYER_SLOTS: readonly AvatarLayerSlotSpec[] = [
  { slot: 'silhouetteId', layerType: 'avatar_base', zIndex: 10, supportsTint: true, alwaysEmit: true },
  { slot: 'pantsId', layerType: 'avatar_pants', zIndex: 20 },
  { slot: 'shoesId', layerType: 'avatar_shoes', zIndex: 25 },
  { slot: 'clothingId', layerType: 'avatar_clothing', zIndex: 30 },
  { slot: 'faceId', layerType: 'avatar_face', zIndex: 40 },
  { slot: 'eyesId', layerType: 'avatar_eyes', zIndex: 45 },
  { slot: 'mouthId', layerType: 'avatar_mouth', zIndex: 50 },
  { slot: 'hairId', layerType: 'avatar_hair', zIndex: 60 },
  { slot: 'hatId', layerType: 'avatar_hat', zIndex: 70 },
  { slot: 'accessoryId', layerType: 'avatar_accessory', zIndex: 80 },
  { slot: 'handRigId', layerType: 'avatar_hand', zIndex: 90 },
];

export interface AssembledAvatarLayer {
  slot: AvatarConfigSlotKey;
  itemId: string;
  layerType: CosmeticLayerType;
  zIndex: number;
  assetUrl?: string;
  item?: CosmeticItem;
  tintColor?: string;
  crop?: { x: number; y: number; width: number; height: number };
  anchor: AnchorPoint;
}

/**
 * Assembles the active `AvatarConfig` slots into an ordered back-to-front layer list,
 * resolving URLs, atlas crops, and anchor pivots from `catalogIndex` and `@digitalcanopy/assets`.
 */
export function assembleAvatarLayers(
  avatarConfig: AvatarConfig,
  catalogIndex: Record<string, CosmeticItem>,
): AssembledAvatarLayer[] {
  const assembled: AssembledAvatarLayer[] = [];

  for (const spec of AVATAR_LAYER_SLOTS) {
    const itemId = avatarConfig[spec.slot] ?? '';
    if (!itemId && !spec.alwaysEmit) continue;

    const item = itemId ? catalogIndex[itemId] : undefined;
    const assetUrl = itemId ? resolveManifestAssetUrl(itemId, catalogIndex) : undefined;
    const atlasFrame = itemId ? resolveItemAtlasFrame(itemId, item) : undefined;

    assembled.push({
      slot: spec.slot,
      itemId,
      layerType: item?.layerType ?? spec.layerType,
      zIndex: spec.zIndex,
      assetUrl,
      item,
      tintColor: spec.supportsTint ? avatarConfig.tintColor : undefined,
      crop: resolveSpriteCrop(item),
      anchor: atlasFrame?.anchor ?? { ax: 0.5, ay: 0.5 },
    });
  }

  return assembled;
}

export interface BuildCompositeManifestOptions {
  frameId?: string;
  backgroundId?: string;
  landscapeId?: string;
  anchorCoordinates?: { x: number; y: number };
  avatarConfig: AvatarConfig;
  critters?: CritterConfig[];
  catalogIndex: Record<string, CosmeticItem>;
  outputWidth?: number;
  outputHeight?: number;
  format?: 'webp' | 'png';
  quality?: number;
}

/**
 * Builds a complete `CompositeManifest` (background -> landscape -> avatar layers -> critters -> frame)
 * for headless pre-rendering or external canvas consumers.
 */
export function buildAvatarCompositeManifest({
  frameId,
  backgroundId,
  landscapeId,
  anchorCoordinates = { x: 0.5, y: 0.75 },
  avatarConfig,
  critters = [],
  catalogIndex,
  outputWidth = VIRTUAL_CANVAS_SIZE,
  outputHeight = VIRTUAL_CANVAS_SIZE,
  format = 'webp',
  quality = 90,
}: BuildCompositeManifestOptions): CompositeManifest {
  const layers: AssetLayer[] = [];
  const fullBounds = { x: 0, y: 0, width: outputWidth, height: outputHeight };

  if (backgroundId) {
    layers.push({
      itemId: backgroundId,
      layerType: 'background',
      bounds: fullBounds,
      zIndex: 0,
      opacity: 1,
    });
  }

  if (landscapeId) {
    layers.push({
      itemId: landscapeId,
      layerType: 'landscape',
      bounds: fullBounds,
      zIndex: 5,
      opacity: 1,
    });
  }

  const clamped = clampNormalized(anchorCoordinates);
  const avatarOffsetX = (clamped.x - 0.5) * outputWidth;
  const avatarOffsetY = (clamped.y - 0.75) * outputHeight;

  for (const layer of assembleAvatarLayers(avatarConfig, catalogIndex)) {
    if (!layer.itemId) continue;
    layers.push({
      itemId: layer.itemId,
      layerType: layer.layerType,
      bounds: {
        x: avatarOffsetX,
        y: avatarOffsetY,
        width: outputWidth,
        height: outputHeight,
      },
      zIndex: layer.zIndex,
      opacity: 1,
    });
  }

  critters.forEach((critter, idx) => {
    if (!critter.critterId) return;
    layers.push({
      itemId: critter.critterId,
      layerType: 'critter',
      bounds: {
        x: avatarOffsetX,
        y: avatarOffsetY,
        width: Math.round(outputWidth * 0.12),
        height: Math.round(outputHeight * 0.12),
      },
      zIndex: 100 + idx,
      opacity: 1,
    });
  });

  if (frameId) {
    layers.push({
      itemId: frameId,
      layerType: 'avatar_frame',
      bounds: fullBounds,
      zIndex: 200,
      opacity: 0.9,
    });
  }

  return {
    layers: layers.sort((a, b) => a.zIndex - b.zIndex),
    outputWidth,
    outputHeight,
    format,
    quality,
  };
}
