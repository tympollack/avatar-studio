/**
 * @module avatar/schemas
 *
 * Runtime Zod validators for the Avatar & Habitat Studio cosmetic system.
 * These schemas enforce structural correctness at API boundaries, form
 * submissions, and database write paths.
 *
 * Mirrors the TypeScript contracts in `../types/avatar.ts`.
 */

import { z } from 'zod';

// ──────────────────────────────────────────────
// Enum / Literal Schemas
// ──────────────────────────────────────────────

export const CosmeticLayerTypeSchema = z.enum([
  'frame',
  'background',
  'avatar_body',
  'avatar_hand',
  'avatar_clothing',
  'critter',
  'landscape',
]);

export const CosmeticRaritySchema = z.enum([
  'standard',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]);

export const CritterPerchLocationSchema = z.enum([
  'shoulder',
  'pocket',
  'hover',
  'ground',
]);

export const LandscapeThemeSchema = z.enum(['day', 'night']);

// ──────────────────────────────────────────────
// Catalog Item Schema
// ──────────────────────────────────────────────

export const CosmeticItemCatalogSchema = z.object({
  id: z.string().min(1),
  layerType: CosmeticLayerTypeSchema,
  name: z.string().min(1),
  assetUrl: z.string().url(),
  rarity: CosmeticRaritySchema.default('standard'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CosmeticItemCatalogInput = z.input<typeof CosmeticItemCatalogSchema>;
export type CosmeticItemCatalogOutput = z.output<typeof CosmeticItemCatalogSchema>;

// ──────────────────────────────────────────────
// Avatar Config Schema
// ──────────────────────────────────────────────

export const AvatarConfigSchema = z.object({
  silhouetteId: z.string().min(1),
  handRigId: z.string().min(1).optional(),
  tintColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color (e.g. #FF9900)')
    .optional(),
  clothingId: z.string().min(1).optional(),
});

// ──────────────────────────────────────────────
// Critter Config Schema
// ──────────────────────────────────────────────

export const CritterConfigSchema = z.object({
  critterId: z.string().min(1),
  shellId: z.string().min(1).optional(),
  headwearId: z.string().min(1).optional(),
  perchLocation: CritterPerchLocationSchema,
});

// ──────────────────────────────────────────────
// Landscape Config Schema
// ──────────────────────────────────────────────

export const AnchorCoordinatesSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const LandscapeConfigSchema = z.object({
  landscapeId: z.string().min(1),
  anchorCoordinates: AnchorCoordinatesSchema,
  theme: LandscapeThemeSchema,
});

// ──────────────────────────────────────────────
// Pre-Render URL Manifest Schema
// ──────────────────────────────────────────────

export const RenderUrlsSchema = z.object({
  chip: z.string().url(),
  profile: z.string().url(),
  landscape: z.string().url(),
  version: z.number().int().nonnegative(),
});

// ──────────────────────────────────────────────
// User Cosmetic Loadout Schema (Root Validator)
// ──────────────────────────────────────────────

export const UserCosmeticLoadoutSchema = z.object({
  userId: z.string().uuid(),
  frameId: z.string().min(1),
  backgroundId: z.string().min(1),
  avatarConfig: AvatarConfigSchema,
  critters: z.array(CritterConfigSchema).default([]),
  landscapeConfig: LandscapeConfigSchema,
  renderUrls: RenderUrlsSchema,
});

export type UserCosmeticLoadoutInput = z.input<typeof UserCosmeticLoadoutSchema>;
export type UserCosmeticLoadoutOutput = z.output<typeof UserCosmeticLoadoutSchema>;

/**
 * Partial loadout schema for incremental saves (e.g., user changes only their frame).
 * Every field is optional at the top level, but nested objects are validated fully
 * when present.
 */
export const PartialUserCosmeticLoadoutSchema = UserCosmeticLoadoutSchema.partial();

export type PartialUserCosmeticLoadoutInput = z.input<typeof PartialUserCosmeticLoadoutSchema>;

// ──────────────────────────────────────────────
// Compositing Helpers
// ──────────────────────────────────────────────

export const CompositingBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const AssetLayerSchema = z.object({
  itemId: z.string().min(1),
  layerType: CosmeticLayerTypeSchema,
  bounds: CompositingBoundsSchema,
  zIndex: z.number().int(),
  opacity: z.number().min(0).max(1),
});

export const CompositeManifestSchema = z.object({
  layers: z.array(AssetLayerSchema).min(1),
  outputWidth: z.number().int().positive(),
  outputHeight: z.number().int().positive(),
  format: z.enum(['webp', 'png']).default('webp'),
  quality: z.number().int().min(1).max(100).default(90),
});

export type CompositeManifestInput = z.input<typeof CompositeManifestSchema>;
export type CompositeManifestOutput = z.output<typeof CompositeManifestSchema>;
