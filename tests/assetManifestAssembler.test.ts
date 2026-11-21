import { describe, it, expect } from '@jest/globals';
import {
  KENNEY_CDN_BASE,
  MODULAR_CHARACTERS,
  ISOMETRIC_TILES,
  modularCharactersAtlas,
  getFrameCoordinates,
} from '@digitalcanopy/assets';
import {
  AVATAR_LAYER_SLOTS,
  assembleAvatarLayers,
  buildAvatarCompositeManifest,
  buildKenneyManifestCatalog,
  parseModularCharacterKey,
  resolveManifestAssetUrl,
  resolveSpriteCrop,
} from '../src/utils/assetManifest';
import { CompositeManifestSchema } from '../src/schemas/avatar';
import type { CosmeticItem } from '../src/types/avatar';
import { buildChipSvg, buildProfileSvg, fetchLayerAsset, type Env } from '../functions/api/prerender';

describe('TASK-PKG-APP-AVATAR: Multi-Layer Canvas Assembler via @digitalcanopy/assets', () => {
  describe('parseModularCharacterKey', () => {
    it('parses all 6 Kenney modular character categories into normalized CosmeticLayerTypes', () => {
      expect(parseModularCharacterKey('char-skin-skin-beige-0')).toEqual({
        key: 'char-skin-skin-beige-0',
        category: 'skin',
        itemKey: 'skin-beige-0',
        layerType: 'avatar_base',
        displayName: 'Skin Beige 0',
      });
      expect(parseModularCharacterKey('char-face-face-0')?.layerType).toBe('avatar_face');
      expect(parseModularCharacterKey('char-hair-hair-blonde-0')?.layerType).toBe('avatar_hair');
      expect(parseModularCharacterKey('char-shirts-shirt-blue-0')?.layerType).toBe('avatar_clothing');
      expect(parseModularCharacterKey('char-pants-pants-blue-0')?.layerType).toBe('avatar_pants');
      expect(parseModularCharacterKey('char-shoes-shoes-brown-0')?.layerType).toBe('avatar_shoes');
    });

    it('returns null for unrecognized keys', () => {
      expect(parseModularCharacterKey('unknown-asset-key')).toBeNull();
    });
  });

  describe('buildKenneyManifestCatalog', () => {
    it('hydrates modular characters, isometric tiles, and UI panel frames from @digitalcanopy/assets', () => {
      const items = buildKenneyManifestCatalog();
      const ids = new Set(items.map((item) => item.id));

      for (const charKey of MODULAR_CHARACTERS) {
        expect(ids.has(charKey)).toBe(true);
      }
      for (const tileKey of ISOMETRIC_TILES) {
        expect(ids.has(tileKey)).toBe(true);
      }

      const blondeHair = items.find((item) => item.id === 'char-hair-hair-blonde-0');
      expect(blondeHair).toBeDefined();
      expect(blondeHair?.layerType).toBe('avatar_hair');
      expect(blondeHair?.assetUrl).toBe(
        `${KENNEY_CDN_BASE}/modular-characters/hair/hair-blonde-0.png`
      );
      expect(blondeHair?.metadata.atlasUrl).toBe(modularCharactersAtlas.meta.image);
      expect(blondeHair?.metadata.atlasFrame).toEqual(
        getFrameCoordinates(modularCharactersAtlas, 'char-hair-hair-blonde-0')
      );
    });
  });

  describe('resolveManifestAssetUrl & resolveSpriteCrop', () => {
    it('prioritizes catalogIndex custom IP URLs and falls back to @digitalcanopy/assets R2 CDN URLs', () => {
      const customCatalog: Record<string, CosmeticItem> = {
        'char-hair-hair-blonde-0': {
          id: 'char-hair-hair-blonde-0',
          layerType: 'avatar_hair',
          name: 'Custom IP Blonde',
          assetUrl: 'https://assets.sunshade.icu/custom/hair_blonde.png',
          rarity: 'epic',
          metadata: {},
        },
      };

      expect(resolveManifestAssetUrl('char-hair-hair-blonde-0', customCatalog)).toBe(
        'https://assets.sunshade.icu/custom/hair_blonde.png'
      );

      // Unoverridden manifest key falls back directly to @digitalcanopy/assets R2 CDN URL
      expect(resolveManifestAssetUrl('char-pants-pants-blue-0', customCatalog)).toBe(
        `${KENNEY_CDN_BASE}/modular-characters/pants/pants-blue-0.png`
      );

      expect(resolveManifestAssetUrl('tile-isometric-grass', customCatalog)).toBe(
        `${KENNEY_CDN_BASE}/isometric-tiles/tile-isometric-grass.png`
      );

      expect(resolveManifestAssetUrl('panel-glass', customCatalog)).toBe(
        `${KENNEY_CDN_BASE}/ui-pack/panel-glass.png`
      );

      expect(resolveManifestAssetUrl('non-existent-id', customCatalog)).toBeUndefined();
    });

    it('returns atlas crop coordinates only when targeting a packed sprite sheet', () => {
      const items = buildKenneyManifestCatalog();
      const individualItem = items.find((i) => i.id === 'char-face-face-2')!;
      expect(resolveSpriteCrop(individualItem)).toBeUndefined();

      const atlasBackedItem: CosmeticItem = {
        ...individualItem,
        assetUrl: modularCharactersAtlas.meta.image,
      };
      expect(resolveSpriteCrop(atlasBackedItem)).toEqual({
        x: 256,
        y: 0,
        width: 128,
        height: 128,
      });
    });
  });

  describe('assembleAvatarLayers & buildAvatarCompositeManifest', () => {
    it('assembles all equipped modular character layers in deterministic back-to-front z-order', () => {
      const layers = assembleAvatarLayers(
        {
          silhouetteId: 'char-skin-skin-beige-0',
          pantsId: 'char-pants-pants-blue-0',
          shoesId: 'char-shoes-shoes-brown-0',
          clothingId: 'char-shirts-shirt-red-0',
          faceId: 'char-face-face-1',
          hairId: 'char-hair-hair-black-0',
          tintColor: '#ffaa00',
        },
        {}
      );

      expect(layers.map((l) => l.slot)).toEqual([
        'silhouetteId',
        'pantsId',
        'shoesId',
        'clothingId',
        'faceId',
        'hairId',
      ]);

      for (let i = 1; i < layers.length; i++) {
        expect(layers[i].zIndex).toBeGreaterThan(layers[i - 1].zIndex);
      }

      expect(layers[0].tintColor).toBe('#ffaa00');
      expect(layers[0].assetUrl).toBe(
        `${KENNEY_CDN_BASE}/modular-characters/skin/skin-beige-0.png`
      );
      expect(layers[1].tintColor).toBeUndefined();
      expect(layers[1].assetUrl).toBe(
        `${KENNEY_CDN_BASE}/modular-characters/pants/pants-blue-0.png`
      );
      expect(layers[5].assetUrl).toBe(
        `${KENNEY_CDN_BASE}/modular-characters/hair/hair-black-0.png`
      );
    });

    it('always emits base silhouette slot for fallback rendering when unequipped', () => {
      const layers = assembleAvatarLayers({ silhouetteId: '', tintColor: '#334155' }, {});
      expect(layers).toHaveLength(1);
      expect(layers[0].slot).toBe('silhouetteId');
      expect(layers[0].assetUrl).toBeUndefined();
      expect(layers[0].tintColor).toBe('#334155');
    });

    it('builds a valid CompositeManifest across background, landscape, modular avatar, critters, and frame', () => {
      const manifest = buildAvatarCompositeManifest({
        frameId: 'panel-glass',
        landscapeId: 'tile-isometric-grass',
        anchorCoordinates: { x: 0.5, y: 0.75 },
        avatarConfig: {
          silhouetteId: 'char-skin-skin-light-0',
          pantsId: 'char-pants-pants-black-0',
          shoesId: 'char-shoes-shoes-white-0',
          clothingId: 'char-shirts-shirt-blue-0',
          faceId: 'char-face-face-0',
          hairId: 'char-hair-hair-blonde-0',
        },
        critters: [{ critterId: 'critter-1', perchLocation: 'shoulder' }],
        catalogIndex: {},
      });

      expect(CompositeManifestSchema.safeParse(manifest).success).toBe(true);
      expect(manifest.layers.map((l) => l.layerType)).toEqual([
        'landscape',
        'avatar_base',
        'avatar_pants',
        'avatar_shoes',
        'avatar_clothing',
        'avatar_face',
        'avatar_hair',
        'critter',
        'avatar_frame',
      ]);
      expect(AVATAR_LAYER_SLOTS.length).toBeGreaterThanOrEqual(11);
    });
  });

  describe('Edge Prerenderer integration with @digitalcanopy/assets', () => {
    it('includes pantsId, shoesId, and faceId layers in chip and profile SVGs', () => {
      const resolvedImages = {
        skin: 'data:image/png;base64,SKIN',
        pants: 'data:image/png;base64,PANTS',
        shoes: 'data:image/png;base64,SHOES',
        shirt: 'data:image/png;base64,SHIRT',
        face: 'data:image/png;base64,FACE',
        hair: 'data:image/png;base64,HAIR',
      };

      const config = {
        silhouetteId: 'skin',
        pantsId: 'pants',
        shoesId: 'shoes',
        clothingId: 'shirt',
        faceId: 'face',
        hairId: 'hair',
      };

      const chipSvg = buildChipSvg(config, resolvedImages);
      const profileSvg = buildProfileSvg(config, '', '', [], resolvedImages);

      for (const svg of [chipSvg, profileSvg]) {
        const pantsIdx = svg.indexOf('data:image/png;base64,PANTS');
        const shoesIdx = svg.indexOf('data:image/png;base64,SHOES');
        const shirtIdx = svg.indexOf('data:image/png;base64,SHIRT');
        const faceIdx = svg.indexOf('data:image/png;base64,FACE');
        const hairIdx = svg.indexOf('data:image/png;base64,HAIR');

        expect(pantsIdx).toBeGreaterThan(0);
        expect(shoesIdx).toBeGreaterThan(pantsIdx);
        expect(shirtIdx).toBeGreaterThan(shoesIdx);
        expect(faceIdx).toBeGreaterThan(shirtIdx);
        expect(hairIdx).toBeGreaterThan(faceIdx);
      }
    });

    it('resolves @digitalcanopy/assets manifest keys from R2 bucket in fetchLayerAsset', async () => {
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
      const requestedKeys: string[] = [];

      const mockEnv: Env = {
        AVATAR_BUCKET: {
          get: async (key: string) => {
            requestedKeys.push(key);
            if (key === 'assets/kenney/modular-characters/hair/hair-blonde-0.png') {
              return {
                key,
                size: pngBytes.byteLength,
                body: pngBytes,
                arrayBuffer: async () => pngBytes,
              };
            }
            return null;
          },
          head: async () => null,
          put: async () => ({}),
          delete: async () => {},
        },
      };

      const fetched = await fetchLayerAsset('char-hair-hair-blonde-0', mockEnv);
      expect(fetched).not.toBeNull();
      expect(fetched?.format).toBe('png');
      expect(fetched?.dataUri).toMatch(/^data:image\/png;base64,/);
      expect(requestedKeys).toContain('assets/kenney/modular-characters/hair/hair-blonde-0.png');
    });
  });
});
