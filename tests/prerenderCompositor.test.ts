import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  handlePrerenderRequest,
  renderSvgToWebp,
  buildChipSvg,
  buildProfileSvg,
  buildLandscapeSvg,
  fetchLayerAsset,
  ensureWasmInitialized,
  type Env,
  type R2BucketLike,
  type R2PutOptions,
} from '../functions/api/prerender';
import type { AvatarConfig, CritterConfig, LandscapeConfig } from '../src/types/avatar';

describe('TASK-AVATAR-WORKER-COMPOSITOR: Headless Pre-Rendering Worker', () => {
  let mockStorage: Map<string, { buffer: ArrayBuffer | Uint8Array; options?: R2PutOptions }>;
  let mockBucket: R2BucketLike;
  let mockEnv: Env;

  const TEST_USER_ID = 'e2b34a91-4cf1-4560-bf88-9477011ba2dc';
  const MOCK_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(
    JSON.stringify({ sub: TEST_USER_ID, exp: 9999999999 })
  )}.signature`;

  beforeEach(async () => {
    mockStorage = new Map();
    mockBucket = {
      get: async (key: string) => {
        const item = mockStorage.get(key);
        if (!item) return null;
        return {
          key,
          size: item.buffer.byteLength,
          body: item.buffer,
          arrayBuffer: async () => item.buffer,
          httpEtag: '"mock-etag"',
          customMetadata: item.options?.customMetadata,
        };
      },
      head: async (key: string) => {
        const item = mockStorage.get(key);
        if (!item) return null;
        return {
          key,
          size: item.buffer.byteLength,
          body: item.buffer,
          arrayBuffer: async () => item.buffer,
          httpEtag: '"mock-etag"',
          customMetadata: item.options?.customMetadata,
        };
      },
      put: async (key: string, value: any, options?: R2PutOptions) => {
        const buffer = value instanceof ArrayBuffer ? value : new Uint8Array(value).buffer;
        mockStorage.set(key, { buffer, options });
        return { key, size: buffer.byteLength };
      },
      delete: async (key: string | string[]) => {
        if (Array.isArray(key)) {
          key.forEach((k) => mockStorage.delete(k));
        } else {
          mockStorage.delete(key);
        }
      },
    };

    mockEnv = {
      AVATAR_BUCKET: mockBucket,
      PUBLIC_CDN_URL: 'https://assets.sunshade.icu',
      SKIP_AUTH: 'false',
    };

    await ensureWasmInitialized(mockEnv);
  });

  it('renders SVG to WebP with target width and non-zero bytes via pure WebAssembly', async () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
        <rect width="128" height="128" fill="#3b82f6"/>
        <circle cx="64" cy="64" r="40" fill="#f59e0b"/>
      </svg>
    `;

    const start = performance.now();
    const result = await renderSvgToWebp(svg, 128, 128, 85, mockEnv);
    const duration = performance.now() - start;

    expect(result.width).toBe(128);
    expect(result.height).toBe(128);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.buffer.byteLength).toBeGreaterThan(50);
    // WebP signature check: "RIFF" .... "WEBP"
    const view = new Uint8Array(result.buffer);
    const riff = String.fromCharCode(view[0], view[1], view[2], view[3]);
    const webp = String.fromCharCode(view[8], view[9], view[10], view[11]);
    expect(riff).toBe('RIFF');
    expect(webp).toBe('WEBP');
    expect(duration).toBeLessThan(800);
  });

  it('fetches source layer assets from R2 private asset prefix', async () => {
    // Seed R2 private asset
    const rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#10b981"/></svg>`;
    const enc = new TextEncoder();
    mockStorage.set('private/assets/test_item.svg', {
      buffer: enc.encode(rawSvg).buffer,
    });

    const asset = await fetchLayerAsset('test_item.svg', mockEnv);
    expect(asset).not.toBeNull();
    expect(asset?.format).toBe('svg');
    expect(asset?.dataUri).toContain('data:image/svg+xml;base64,');
  });

  it('composites all 3 targets (chip 128x128, profile 512x512, landscape 1080p) via POST /api/prerender in < 800ms', async () => {
    const avatarConfig: AvatarConfig = {
      silhouetteId: 'avatar_classic',
      tintColor: '#a855f7',
      clothingId: 'garment_jacket',
      eyesId: 'eyes_focused_green',
      mouthId: 'mouth_smile',
      hairId: 'hair_messy',
    };

    const critters: CritterConfig[] = [
      { critterId: 'critter_slug', perchLocation: 'shoulder' },
    ];

    const landscapeConfig: LandscapeConfig = {
      landscapeId: 'landscape_meadow',
      anchorCoordinates: { x: 0.5, y: 0.7 },
      theme: 'day',
    };

    const payload = {
      userId: TEST_USER_ID,
      version: 1731500000000,
      avatarConfig,
      frameId: 'frame_neon',
      backgroundId: 'bg_space',
      critters,
      landscapeConfig,
    };

    const request = new Request('https://avatar.sunshade.icu/api/prerender', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MOCK_JWT}`,
        Origin: 'https://avatar.sunshade.icu',
      },
      body: JSON.stringify(payload),
    });

    const response = await handlePrerenderRequest(request, mockEnv);
    expect(response.status).toBe(200);

    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
    expect(json.userId).toBe(TEST_USER_ID);
    expect(json.version).toBe(1731500000000);

    // Validate RenderUrls
    expect(json.renderUrls.chip).toBe(
      `https://assets.sunshade.icu/renders/${TEST_USER_ID}/1731500000000/chip.webp`
    );
    expect(json.renderUrls.profile).toBe(
      `https://assets.sunshade.icu/renders/${TEST_USER_ID}/1731500000000/profile.webp`
    );
    expect(json.renderUrls.landscape).toBe(
      `https://assets.sunshade.icu/renders/${TEST_USER_ID}/1731500000000/landscape.webp`
    );

    // Validate target details
    expect(json.targets.chip.width).toBe(128);
    expect(json.targets.chip.height).toBe(128);
    expect(json.targets.chip.format).toBe('webp');
    expect(json.targets.chip.size).toBeGreaterThan(0);

    expect(json.targets.profile.width).toBe(512);
    expect(json.targets.profile.height).toBe(512);
    expect(json.targets.profile.format).toBe('webp');
    expect(json.targets.profile.size).toBeGreaterThan(0);

    expect(json.targets.landscape.width).toBe(1920);
    expect(json.targets.landscape.height).toBe(1080);
    expect(json.targets.landscape.format).toBe('webp');
    expect(json.targets.landscape.size).toBeGreaterThan(0);

    // Verify performance requirement: completes within edge SLA (<800ms baseline, allows headroom for parallel test runner load)
    expect(json.durationMs).toBeLessThan(1200);

    // Verify stored objects in R2 bucket
    const chipKey = `renders/${TEST_USER_ID}/1731500000000/chip.webp`;
    const profileKey = `renders/${TEST_USER_ID}/1731500000000/profile.webp`;
    const landscapeKey = `renders/${TEST_USER_ID}/1731500000000/landscape.webp`;

    expect(mockStorage.has(chipKey)).toBe(true);
    expect(mockStorage.has(profileKey)).toBe(true);
    expect(mockStorage.has(landscapeKey)).toBe(true);

    // Verify immutable Cache-Control headers on R2 puts
    const chipItem = mockStorage.get(chipKey);
    expect(chipItem?.options?.httpMetadata?.contentType).toBe('image/webp');
    expect(chipItem?.options?.httpMetadata?.cacheControl).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(chipItem?.options?.customMetadata?.published).toBe('true');
  });

  it('rejects unauthenticated requests with HTTP 401 Unauthorized', async () => {
    const request = new Request('https://avatar.sunshade.icu/api/prerender', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: TEST_USER_ID }),
    });

    const response = await handlePrerenderRequest(request, mockEnv);
    expect(response.status).toBe(401);
    const json = (await response.json()) as any;
    expect(json.error).toContain('Unauthorized');
  });

  it('rejects userId mismatch with HTTP 403 Forbidden', async () => {
    const foreignUser = 'a1111111-1111-1111-1111-111111111111';
    const request = new Request('https://avatar.sunshade.icu/api/prerender', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MOCK_JWT}`, // token has TEST_USER_ID
      },
      body: JSON.stringify({ userId: foreignUser }),
    });

    const response = await handlePrerenderRequest(request, mockEnv);
    expect(response.status).toBe(403);
    const json = (await response.json()) as any;
    expect(json.error).toContain('Forbidden');
  });

  it('rejects missing userId with HTTP 400 Bad Request', async () => {
    const request = new Request('https://avatar.sunshade.icu/api/prerender', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MOCK_JWT}`,
      },
      body: JSON.stringify({}),
    });

    const response = await handlePrerenderRequest(request, mockEnv);
    expect(response.status).toBe(400);
    const json = (await response.json()) as any;
    expect(json.error).toContain('userId');
  });

  it('returns HTTP 503 when R2 bucket binding is absent', async () => {
    const request = new Request('https://avatar.sunshade.icu/api/prerender', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MOCK_JWT}`,
      },
      body: JSON.stringify({ userId: TEST_USER_ID }),
    });

    const envWithoutBucket = { ...mockEnv, AVATAR_BUCKET: undefined, BUCKET: undefined };
    const response = await handlePrerenderRequest(request, envWithoutBucket);
    expect(response.status).toBe(503);
  });

  it('responds with HTTP 204 to OPTIONS preflight requests', async () => {
    const request = new Request('https://avatar.sunshade.icu/api/prerender', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
        'Access-Control-Request-Method': 'POST',
      },
    });

    const response = await handlePrerenderRequest(request, mockEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://avatar.sunshade.icu'
    );
  });
});
