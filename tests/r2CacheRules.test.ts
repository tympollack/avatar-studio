import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isOriginAllowed,
  isPublicAssetKey,
  handleAssetRequest,
} from '../scripts/assets-edge-worker';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('TASK-AVATAR-R2-CACHE-RULES: Cloudflare R2 Bindings, CDN Caching, and Invalidation', () => {
  const rootDir = path.resolve(__dirname, '..');
  const wranglerPath = path.resolve(rootDir, 'wrangler.toml');
  const headersPath = path.resolve(rootDir, 'public/_headers');
  const corsPath = path.resolve(rootDir, 'config/r2-cors.json');

  it('validates wrangler.toml configures AVATAR_BUCKET native R2 binding and pages build dir', () => {
    expect(fs.existsSync(wranglerPath)).toBe(true);
    const content = fs.readFileSync(wranglerPath, 'utf8');

    // Pages build directory
    expect(content).toMatch(/pages_build_output_dir\s*=\s*["']dist["']/);

    // R2 Bucket binding
    expect(content).toMatch(/\[\[r2_buckets\]\]/);
    expect(content).toMatch(/binding\s*=\s*["']AVATAR_BUCKET["']/);
    expect(content).toMatch(/bucket_name\s*=\s*["']sunshade-assets["']/);

    // Nodejs compatibility flag for isolates
    expect(content).toMatch(/compatibility_flags\s*=\s*\[.*"nodejs_compat".*\]/);

    // CDN custom domain vars
    expect(content).toMatch(/PUBLIC_CDN_URL\s*=\s*["']https:\/\/assets\.sunshade\.icu["']/);
  });

  it('validates public/_headers establishes immutable 1-year cache headers on /renders/*', () => {
    expect(fs.existsSync(headersPath)).toBe(true);
    const headersContent = fs.readFileSync(headersPath, 'utf8');

    expect(headersContent).toContain('/renders/*');
    expect(headersContent).toMatch(
      /\/renders\/\*[\s\S]*?Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/i
    );
    expect(headersContent).toMatch(/\/renders\/\*[\s\S]*?Access-Control-Allow-Origin:\s*\*/i);
  });

  it('validates config/r2-cors.json allows *.sunshade.icu and localhost origins', () => {
    expect(fs.existsSync(corsPath)).toBe(true);
    const corsConfig = JSON.parse(fs.readFileSync(corsPath, 'utf8'));
    const rule = corsConfig[0];

    expect(rule.AllowedOrigins).toContain('https://*.sunshade.icu');
    expect(rule.AllowedOrigins).toContain('https://avatar.sunshade.icu');
    expect(rule.AllowedOrigins).toContain('https://hub.sunshade.icu');
    expect(rule.AllowedOrigins).toContain('https://cozy.sunshade.icu');
    expect(rule.AllowedOrigins).toContain('http://localhost:*');
    expect(rule.ExposeHeaders).toContain('Cache-Control');
  });

  it('validates edge router allows *.sunshade.icu origins and localhost', () => {
    expect(isOriginAllowed('https://avatar.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('https://hub.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('https://cozy.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('https://assets.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('https://media.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('https://sunshade.icu')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000')).toBe(true);
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://localhost')).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:8787')).toBe(true);

    // Disallowed
    expect(isOriginAllowed('https://attacker.site.com')).toBe(false);
    expect(isOriginAllowed('https://sub.avatar.sunshade.icu')).toBe(false);
  });

  it('permits versioned render paths under PUBLIC_ASSET_REGEX in assets edge worker', () => {
    const validRenderKey =
      'renders/e2b34a91-4cf1-4560-bf88-9477011ba2dc/1731500000000/chip.webp';
    expect(isPublicAssetKey(validRenderKey)).toBe(true);

    const validProfileKey =
      'renders/e2b34a91-4cf1-4560-bf88-9477011ba2dc/1731500000000/profile.webp';
    expect(isPublicAssetKey(validProfileKey)).toBe(true);

    const validLandscapeKey =
      'renders/e2b34a91-4cf1-4560-bf88-9477011ba2dc/1731500000000/landscape.webp';
    expect(isPublicAssetKey(validLandscapeKey)).toBe(true);

    // Non-public path
    expect(isPublicAssetKey('private/renders/secret.webp')).toBe(false);
    expect(isPublicAssetKey('draft/renders/chip.webp')).toBe(false);
  });

  it('attaches immutable Cache-Control header when edge worker serves renders/* assets', async () => {
    const mockEnv = {
      BUCKET: {
        get: async (_key: string) => ({
          body: new ReadableStream(),
          httpEtag: '"mock-render-etag"',
          writeHttpMetadata: (headers: Headers) => {
            headers.set('Content-Type', 'image/webp');
          },
        }),
        head: async (_key: string) => ({
          httpEtag: '"mock-render-etag"',
          writeHttpMetadata: (headers: Headers) => {
            headers.set('Content-Type', 'image/webp');
          },
        }),
      },
    };

    const request = new Request(
      'https://assets.sunshade.icu/renders/e2b34a91-4cf1-4560-bf88-9477011ba2dc/1731500000000/chip.webp',
      {
        method: 'GET',
        headers: {
          Origin: 'https://avatar.sunshade.icu',
        },
      }
    );

    const response = await handleAssetRequest(request, mockEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://avatar.sunshade.icu'
    );
  });

  it('restricts immutable caching to renders/ and explicit v[0-9]+ directories, not arbitrary hex keys', async () => {
    const mockEnv = {
      BUCKET: {
        get: async (_key: string) => ({
          body: new ReadableStream(),
          httpEtag: '"mock-etag"',
          writeHttpMetadata: (headers: Headers) => {
            headers.set('Content-Type', 'image/png');
          },
        }),
        head: async (_key: string) => ({
          httpEtag: '"mock-etag"',
          writeHttpMetadata: (headers: Headers) => {
            headers.set('Content-Type', 'image/png');
          },
        }),
      },
    };

    // Versioned path: receives immutable cache
    const versionedReq = new Request('https://assets.sunshade.icu/assets/avatar/v2/banner.png');
    const versionedRes = await handleAssetRequest(versionedReq, mockEnv);
    expect(versionedRes.status).toBe(200);
    expect(versionedRes.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    // Arbitrary hex filename: should NOT receive immutable cache header
    const nonVersionedReq = new Request('https://assets.sunshade.icu/assets/avatar/a1b2c3d4e5f6.png');
    const nonVersionedRes = await handleAssetRequest(nonVersionedReq, mockEnv);
    expect(nonVersionedRes.status).toBe(200);
    expect(nonVersionedRes.headers.get('Cache-Control')).toBeNull();
  });
});
