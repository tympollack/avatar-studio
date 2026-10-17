import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  isOriginAllowed,
  getCorsHeaders,
  handleOptions,
  handleAssetRequest,
} from '../scripts/assets-edge-worker';

import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('TASK-AVATAR-R2-CORS-POLICY: Cloudflare R2 CORS and Edge Router', () => {
  const corsConfigPath = path.resolve(__dirname, '../config/r2-cors.json');

  it('validates config/r2-cors.json specifies allowed origins, methods, and exposed headers', () => {
    expect(fs.existsSync(corsConfigPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(corsConfigPath, 'utf8'));
    expect(Array.isArray(content)).toBe(true);
    const rule = content[0];

    expect(rule.AllowedOrigins).toEqual(
      expect.arrayContaining([
        'https://avatar.sunshade.icu',
        'https://hub.sunshade.icu',
        'https://cozy.sunshade.icu',
        'http://localhost:*',
      ])
    );
    expect(rule.AllowedMethods).toEqual(expect.arrayContaining(['GET', 'HEAD', 'OPTIONS']));
    expect(rule.AllowedHeaders).toContain('*');
    expect(rule.ExposeHeaders).toEqual(
      expect.arrayContaining(['ETag', 'Content-Type', 'Cache-Control'])
    );
    expect(rule.MaxAgeSeconds).toBe(86400);
  });

  it('correctly validates allowed origins pattern matching', () => {
    expect(isOriginAllowed('https://avatar.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('https://hub.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('https://cozy.sunshade.icu')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000')).toBe(true);
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('http://localhost')).toBe(true);

    // Disallowed origins
    expect(isOriginAllowed('https://malicious.site.com')).toBe(false);
    expect(isOriginAllowed('https://sub.avatar.sunshade.icu')).toBe(false);
  });

  it('returns HTTP 204 with CORS headers on OPTIONS preflight', () => {
    const request = new Request('https://assets.sunshade.icu/kenney/modular-characters/eyes/focused_green.png', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
        'Access-Control-Request-Method': 'GET',
      },
    });

    const response = handleOptions(request);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://avatar.sunshade.icu');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('attaches CORS headers to GET asset requests when bucket is bound', async () => {
    const mockEnv = {
      BUCKET: {
        get: async (_key: string) => ({
          body: new ReadableStream(),
          httpEtag: '"mock-etag"',
          writeHttpMetadata: (headers: Headers) => {
            headers.set('Content-Type', 'image/png');
            headers.set('Cache-Control', 'public, max-age=86400');
          },
        }),
        head: async (_key: string) => ({
          httpEtag: '"mock-etag"',
          writeHttpMetadata: (headers: Headers) => {
            headers.set('Content-Type', 'image/png');
            headers.set('Cache-Control', 'public, max-age=86400');
          },
        }),
      },
    };

    const request = new Request('https://assets.sunshade.icu/kenney/modular-characters/eyes/focused_green.png', {
      method: 'GET',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
      },
    });

    const response = await handleAssetRequest(request, mockEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://avatar.sunshade.icu');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('ETag');
  });

  it('returns HTTP 503 Service Unavailable when R2 BUCKET is unbound', async () => {
    const request = new Request('https://assets.sunshade.icu/kenney/modular-characters/eyes/focused_green.png', {
      method: 'GET',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
      },
    });

    const response = await handleAssetRequest(request);
    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://avatar.sunshade.icu');
  });

  it('decodes URL-encoded asset paths correctly', async () => {
    let queriedKey = '';
    const mockEnv = {
      BUCKET: {
        get: async (key: string) => {
          queriedKey = key;
          return {
            body: new ReadableStream(),
            httpEtag: '"mock-etag"',
            writeHttpMetadata: () => {},
          };
        },
        head: async () => null,
      },
    };

    const request = new Request('https://assets.sunshade.icu/assets/avatar/blue%20hat.png', {
      method: 'GET',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
      },
    });

    const response = await handleAssetRequest(request, mockEnv);
    expect(response.status).toBe(200);
    expect(queriedKey).toBe('assets/avatar/blue hat.png');
  });

  it('returns HTTP 400 Bad Request on malformed URI encoding', async () => {
    const request = new Request('https://assets.sunshade.icu/kenney/%E0%A4%A', {
      method: 'GET',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
      },
    });

    const response = await handleAssetRequest(request);
    expect(response.status).toBe(400);
  });

  it('rejects path traversal attempts with HTTP 403 Forbidden', async () => {
    const request = new Request('https://assets.sunshade.icu/kenney/../private/secrets.json', {
      method: 'GET',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
      },
    });

    const response = await handleAssetRequest(request);
    expect(response.status).toBe(403);
  });

  it('rejects non-public asset paths with HTTP 403 Forbidden', async () => {
    const request = new Request('https://assets.sunshade.icu/private/secret-credentials.json', {
      method: 'GET',
      headers: {
        Origin: 'https://avatar.sunshade.icu',
      },
    });

    const response = await handleAssetRequest(request);
    expect(response.status).toBe(403);
  });
});
