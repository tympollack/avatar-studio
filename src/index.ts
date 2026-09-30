/**
 * @module @digitalcanopy/avatar-studio
 *
 * Public API surface for the Avatar & Habitat Studio package.
 * Re-exports all TypeScript contracts and Zod runtime validators.
 */

// TypeScript type contracts
export type {
  CosmeticLayerType,
  CosmeticRarity,
  CosmeticItem,
  AvatarConfig,
  CritterPerchLocation,
  CritterConfig,
  AnchorCoordinates,
  LandscapeTheme,
  LandscapeConfig,
  RenderUrls,
  UserCosmeticLoadout,
  CompositingBounds,
  AssetLayer,
  CompositeManifest,
} from './types/avatar.js';

// Zod runtime validators
export {
  CosmeticLayerTypeSchema,
  CosmeticRaritySchema,
  CritterPerchLocationSchema,
  LandscapeThemeSchema,
  CosmeticItemCatalogSchema,
  AvatarConfigSchema,
  CritterConfigSchema,
  AnchorCoordinatesSchema,
  LandscapeConfigSchema,
  RenderUrlsSchema,
  UserCosmeticLoadoutSchema,
  PartialUserCosmeticLoadoutSchema,
  CompositingBoundsSchema,
  AssetLayerSchema,
  CompositeManifestSchema,
} from './schemas/avatar.js';

// Zod inferred types
export type {
  CosmeticItemCatalogInput,
  CosmeticItemCatalogOutput,
  UserCosmeticLoadoutInput,
  UserCosmeticLoadoutOutput,
  PartialUserCosmeticLoadoutInput,
  CompositeManifestInput,
  CompositeManifestOutput,
} from './schemas/avatar.js';
