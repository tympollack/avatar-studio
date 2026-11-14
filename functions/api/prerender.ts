/**
 * @module functions/api/prerender
 *
 * Headless Edge Compositing Worker for Multi-Resolution WebP Generation.
 * Cloudflare Pages Function: POST /api/prerender
 *
 * Capabilities:
 * 1. Accepts authenticated user ID and loadout manifest (or CompositeManifest).
 * 2. Fetches source layer assets from Cloudflare R2 private asset prefix (env.AVATAR_BUCKET).
 * 3. Composites multi-layer vectors/rasters into 3 distinct targets using pure WebAssembly:
 *    - chip: 128×128 circular avatar for badges, chat bubbles, and compact HUD.
 *    - profile: 512×512 framed avatar for profile cards, banners, and settings.
 *    - landscape: 1920×1080 (1080p) flattened habitat scene with time-of-day theme.
 * 4. Encodes and writes optimized WebP binaries directly to R2 public paths:
 *    renders/{userId}/{version}/{target}.webp
 *    with immutable 1-year cache-control headers (`public, max-age=31536000, immutable`).
 * 5. Updates `hub.user_cosmetic_loadouts` with latest render URLs and version metadata.
 *
 * Runtime:
 * Runs purely on V8 WebAssembly isolates via @resvg/resvg-wasm and @jsquash/webp.
 * Zero node-canvas or native OS dependencies.
 */

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import encodeWebp, { init as initWebp } from '@jsquash/webp/encode.js';
import { createClient } from '@supabase/supabase-js';
import type {
  UserCosmeticLoadout,
  RenderUrls,
  CompositeManifest,
  AvatarConfig,
  CritterConfig,
  LandscapeConfig,
} from '../../src/types/avatar';
import { isOriginAllowed } from '../../scripts/assets-edge-worker';

// ──────────────────────────────────────────────
// Interfaces & Bindings
// ──────────────────────────────────────────────

export interface R2HttpMetadata {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  [key: string]: unknown;
}

export interface R2PutOptions {
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectLike {
  key: string;
  size: number;
  httpEtag?: string;
  customMetadata?: Record<string, string>;
  writeHttpMetadata?: (headers: Headers) => void;
  body: ReadableStream | ArrayBuffer;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  get: (key: string) => Promise<R2ObjectLike | null>;
  head: (key: string) => Promise<R2ObjectLike | null>;
  put: (
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream | string,
    options?: R2PutOptions
  ) => Promise<unknown>;
  delete: (key: string | string[]) => Promise<void>;
}

export interface Env {
  AVATAR_BUCKET?: R2BucketLike;
  BUCKET?: R2BucketLike;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  PUBLIC_CDN_URL?: string;
  MEDIA_CDN_URL?: string;
  RESVG_WASM?: WebAssembly.Module | ArrayBuffer;
  WEBP_WASM?: WebAssembly.Module | ArrayBuffer;
  ASSETS?: { fetch: (request: Request | string | URL) => Promise<Response> };
  SKIP_AUTH?: string;
}

export interface PrerenderRequestBody {
  userId: string;
  loadout?: Partial<UserCosmeticLoadout>;
  frameId?: string;
  backgroundId?: string;
  avatarConfig?: AvatarConfig;
  critters?: CritterConfig[];
  landscapeConfig?: LandscapeConfig;
  manifest?: CompositeManifest;
  assetUrls?: Record<string, string>;
  version?: number;
  quality?: number;
}

export interface TargetRenderResult {
  size: number;
  format: 'webp';
  width: number;
  height: number;
  r2Key: string;
  url: string;
}

export interface PrerenderResponseData {
  success: boolean;
  userId: string;
  version: number;
  renderUrls: RenderUrls;
  persisted?: boolean;
  targets: {
    chip: TargetRenderResult;
    profile: TargetRenderResult;
    landscape: TargetRenderResult;
  };
  durationMs: number;
}

// ──────────────────────────────────────────────
// CORS Headers Configuration
// ──────────────────────────────────────────────

export function getPrerenderCorsHeaders(
  requestOrigin: string | null | undefined
): Record<string, string> {
  const allowOrigin =
    requestOrigin && isOriginAllowed(requestOrigin) ? requestOrigin : 'https://avatar.sunshade.icu';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, *',
    'Access-Control-Expose-Headers': 'ETag, Content-Type, Cache-Control, X-Composite-Duration-Ms',
    'Access-Control-Max-Age': '86400',
  };
}

// ──────────────────────────────────────────────
// WebAssembly Runtime State
// ──────────────────────────────────────────────

let resvgInitialized = false;
let webpInitialized = false;

export async function ensureWasmInitialized(env?: Env, requestUrl?: string): Promise<void> {
  if (!resvgInitialized) {
    if (env?.RESVG_WASM) {
      await initWasm(env.RESVG_WASM);
      resvgInitialized = true;
    } else if (env?.ASSETS?.fetch) {
      try {
        const wasmRes = await env.ASSETS.fetch(
          new URL('/wasm/index_bg.wasm', requestUrl || 'http://localhost')
        );
        if (wasmRes.ok) {
          const buffer = await wasmRes.arrayBuffer();
          await initWasm(buffer);
          resvgInitialized = true;
        }
      } catch {
        // Fallback to fetch or fs
      }
    }

    if (!resvgInitialized && typeof fetch === 'function') {
      try {
        const targetUrl = requestUrl
          ? new URL('/wasm/index_bg.wasm', requestUrl).toString()
          : 'https://avatar.sunshade.icu/wasm/index_bg.wasm';
        const res = await fetch(targetUrl);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          await initWasm(buffer);
          resvgInitialized = true;
        }
      } catch {
        // Fallback to node:fs
      }
    }

    if (!resvgInitialized) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const candidates = [
          path.resolve(process.cwd(), 'node_modules/@resvg/resvg-wasm/index_bg.wasm'),
          path.resolve(process.cwd(), 'public/wasm/index_bg.wasm'),
          path.resolve(process.cwd(), 'dist/wasm/index_bg.wasm'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            const buffer = fs.readFileSync(candidate);
            await initWasm(buffer);
            resvgInitialized = true;
            break;
          }
        }
      } catch {
        // Fallback for edge runtime if bundled or previously loaded
      }
    }
  }

  if (!webpInitialized) {
    if (env?.WEBP_WASM) {
      const module =
        env.WEBP_WASM instanceof WebAssembly.Module
          ? env.WEBP_WASM
          : await WebAssembly.compile(env.WEBP_WASM);
      await initWebp(module);
      webpInitialized = true;
    } else if (env?.ASSETS?.fetch) {
      try {
        const wasmRes = await env.ASSETS.fetch(
          new URL('/wasm/webp_enc_simd.wasm', requestUrl || 'http://localhost')
        );
        if (wasmRes.ok) {
          const buffer = await wasmRes.arrayBuffer();
          const module = await WebAssembly.compile(buffer);
          await initWebp(module);
          webpInitialized = true;
        }
      } catch {
        // Fallback to fetch or fs
      }
    }

    if (!webpInitialized && typeof fetch === 'function') {
      try {
        const targetUrl = requestUrl
          ? new URL('/wasm/webp_enc_simd.wasm', requestUrl).toString()
          : 'https://avatar.sunshade.icu/wasm/webp_enc_simd.wasm';
        const res = await fetch(targetUrl);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const module = await WebAssembly.compile(buffer);
          await initWebp(module);
          webpInitialized = true;
        }
      } catch {
        // Fallback to node:fs
      }
    }

    if (!webpInitialized) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const candidates = [
          path.resolve(
            process.cwd(),
            'node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm'
          ),
          path.resolve(process.cwd(), 'public/wasm/webp_enc_simd.wasm'),
          path.resolve(process.cwd(), 'dist/wasm/webp_enc_simd.wasm'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            const buffer = fs.readFileSync(candidate);
            const module = await WebAssembly.compile(buffer);
            await initWebp(module);
            webpInitialized = true;
            break;
          }
        }
      } catch {
        // Fallback for edge runtime
      }
    }
  }
}

/** Allows unit tests to reset initialization state if required. */
export function resetWasmState(): void {
  resvgInitialized = false;
  webpInitialized = false;
}

// ──────────────────────────────────────────────
// Authentication Helper
// ──────────────────────────────────────────────

export async function verifyAuth(
  request: Request,
  expectedUserId: string,
  env?: Env
): Promise<{ authorized: boolean; error?: string }> {
  // Allow skipping auth if explicitly configured (e.g. mock test harnesses)
  if (env?.SKIP_AUTH === 'true' || process.env.SKIP_AUTH === 'true') {
    return { authorized: true };
  }

  const authHeader = request.headers.get('Authorization');
  const cookieHeader = request.headers.get('Cookie');

  let token: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader
        .split(';')
        .map((c) => c.trim().split('='))
        .filter((pair) => pair.length === 2)
    );
    // Locate Supabase auth cookie: sb-<project>-auth-token or sb-access-token
    for (const [name, val] of Object.entries(cookies)) {
      if (name.includes('auth-token') || name === 'sb-access-token') {
        try {
          const valStr = typeof val === 'string' ? val : String(val);
          const decoded = decodeURIComponent(valStr);
          if (decoded.startsWith('[') || decoded.startsWith('{')) {
            const parsed = JSON.parse(decoded);
            const candidate = parsed.access_token || parsed[0] || decoded;
            token = typeof candidate === 'string' ? candidate : String(candidate);
          } else {
            token = decoded;
          }
        } catch {
          token = typeof val === 'string' ? val : String(val);
        }
        break;
      }
    }
  }

  if (!token) {
    return { authorized: false, error: 'Unauthorized: Missing authentication token or cookie' };
  }

  // If Supabase credentials exist, verify token against Supabase auth
  const supabaseUrl = env?.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnon = env?.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseAnon) {
    try {
      const client = createClient(supabaseUrl, supabaseAnon, {
        auth: { persistSession: false },
      });
      const { data: { user }, error } = await client.auth.getUser(token);
      if (error || !user) {
        return { authorized: false, error: 'Unauthorized: Invalid authentication session' };
      }
      if (user.id !== expectedUserId) {
        return {
          authorized: false,
          error: `Forbidden: Authenticated user (${user.id}) does not match request userId (${expectedUserId})`,
        };
      }
      return { authorized: true };
    } catch (err: unknown) {
      console.warn('[prerender] Supabase auth check error:', (err as Error).message);
    }
  }

  // Fallback: In automated test environment without live Supabase, validate JWT payload claims
  if (process.env.NODE_ENV === 'test') {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(payloadJson);
        const sub = payload.sub || payload.user_id;
        if (sub && sub !== expectedUserId) {
          return {
            authorized: false,
            error: `Forbidden: Token sub (${sub}) does not match request userId (${expectedUserId})`,
          };
        }
        return { authorized: true };
      }
    } catch {
      return { authorized: false, error: 'Unauthorized: Invalid token format' };
    }
  }

  return { authorized: false, error: 'Unauthorized: Authentication service unconfigured' };
}

// ──────────────────────────────────────────────
// R2 Asset Retrieval & SVG Helpers
// ──────────────────────────────────────────────

/**
 * Validates whether an outbound remote URL is safe from SSRF.
 */
function isAllowedRemoteUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const isSunshade = host === 'sunshade.icu' || host.endsWith('.sunshade.icu');
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isSunshade && !isLocal) return false;
    // Prohibit link-local or metadata addresses
    if (
      /^(?:169\.254\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(host) &&
      !isLocal
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes an asset key or URI and resolves it from the R2 private asset prefix.
 */
export async function fetchLayerAsset(
  assetIdOrUrl: string | undefined | null,
  env?: Env,
  assetUrls?: Record<string, string>
): Promise<{ dataUri: string; format: string } | null> {
  if (!assetIdOrUrl) return null;
  // Guard against path traversal and unpublished/draft paths
  if (assetIdOrUrl.includes('..') || assetIdOrUrl.includes('\0')) return null;
  if (/(?:^|\/)(?:draft|internal|unpublished|wip|temp|staging-assets)\//i.test(assetIdOrUrl)) {
    return null;
  }

  const bucket = env?.AVATAR_BUCKET || env?.BUCKET;

  let candidateKey = assetIdOrUrl;
  let mappedPath: string | null = null;

  if (assetUrls?.[assetIdOrUrl]) {
    try {
      const parsed = new URL(assetUrls[assetIdOrUrl]);
      mappedPath = parsed.pathname.replace(/^\/+/, '');
    } catch {
      mappedPath = assetUrls[assetIdOrUrl].replace(/^\/+/, '');
    }
  }

  if (candidateKey.startsWith('http://') || candidateKey.startsWith('https://')) {
    try {
      const parsed = new URL(candidateKey);
      candidateKey = parsed.pathname.replace(/^\/+/, '');
    } catch {
      // keep candidateKey as is
    }
  }

  // Attempt resolving from R2 private and public asset prefixes in parallel
  if (bucket) {
    const candidateKeys: string[] = [];
    if (mappedPath) {
      candidateKeys.push(mappedPath, `assets/${mappedPath}`, `private/assets/${mappedPath}`);
    }

    const hasExt = /\.(png|webp|svg|jpe?g)$/i.test(candidateKey);
    if (hasExt) {
      candidateKeys.push(
        candidateKey,
        `private/assets/${candidateKey}`,
        `assets/${candidateKey}`
      );
    } else {
      candidateKeys.push(
        `private/assets/${candidateKey}.svg`,
        `private/assets/${candidateKey}.png`,
        `private/assets/${candidateKey}.webp`,
        `assets/${candidateKey}.svg`,
        `assets/${candidateKey}.png`,
        `assets/${candidateKey}.webp`,
        candidateKey
      );
    }

    const results = await Promise.all(
      candidateKeys.map(async (key) => {
        try {
          const obj = await bucket.get(key);
          if (!obj) return null;

          // Check publication status on object customMetadata (SEC_0003)
          const metadata = obj.customMetadata;
          if (
            metadata?.published === 'false' ||
            metadata?.visibility === 'private' ||
            metadata?.status === 'draft' ||
            metadata?.status === 'unpublished'
          ) {
            return null;
          }

          let buffer: ArrayBuffer;
          if (typeof obj.arrayBuffer === 'function') {
            buffer = await obj.arrayBuffer();
          } else if (obj.body instanceof ArrayBuffer) {
            buffer = obj.body;
          } else if (typeof (obj.body as any)?.getReader === 'function') {
            const response = new Response(obj.body as ReadableStream);
            buffer = await response.arrayBuffer();
          } else {
            return null;
          }

          // Protect memory from oversized layer inputs (>10MB)
          if (buffer.byteLength > 10 * 1024 * 1024) {
            return null;
          }

          const isSvg = key.endsWith('.svg');
          const isWebp = key.endsWith('.webp');
          const mime = isSvg ? 'image/svg+xml' : isWebp ? 'image/webp' : 'image/png';
          const uint8 = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < uint8.byteLength; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          const base64 = btoa(binary);
          return {
            dataUri: `data:${mime};base64,${base64}`,
            format: isSvg ? 'svg' : isWebp ? 'webp' : 'png',
          };
        } catch {
          return null;
        }
      })
    );

    const match = results.find(Boolean);
    if (match) return match;
  }

  // If remote URL and fetch is available, perform SSRF check before requesting
  if (assetIdOrUrl.startsWith('http://') || assetIdOrUrl.startsWith('https://')) {
    if (!isAllowedRemoteUrl(assetIdOrUrl)) {
      return null;
    }

    try {
      const res = await fetch(assetIdOrUrl);
      if (res.ok) {
        const mime = res.headers.get('content-type') || 'image/png';
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 10 * 1024 * 1024) {
          return null;
        }
        const uint8 = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < uint8.byteLength; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);
        return {
          dataUri: `data:${mime};base64,${base64}`,
          format: mime.includes('webp') ? 'webp' : mime.includes('svg') ? 'svg' : 'png',
        };
      }
    } catch {
      // Fallback
    }
  }

  return null;
}

// ──────────────────────────────────────────────
// Target SVG Compositing Builders
// ──────────────────────────────────────────────

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }
  return null;
}

function buildTintFilterDef(filterId: string, tintColor?: string): string {
  if (!tintColor) return '';
  const rgb = hexToRgb(tintColor);
  if (!rgb) return '';
  const r = (rgb.r / 255).toFixed(3);
  const g = (rgb.g / 255).toFixed(3);
  const b = (rgb.b / 255).toFixed(3);
  return `
    <filter id="${filterId}" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="
        ${r} 0 0 0 0
        0 ${g} 0 0 0
        0 0 ${b} 0 0
        0 0 0 1 0" />
    </filter>
  `.trim();
}

/**
 * Builds the 128×128 circular avatar badge SVG.
 */
export function buildChipSvg(
  avatarConfig: AvatarConfig,
  resolvedImages: Record<string, string>,
  _frameId?: string,
  _backgroundId?: string
): string {
  const tint = avatarConfig.tintColor || '#38bdf8';
  const silhouetteData = resolvedImages[avatarConfig.silhouetteId];
  const clothingData = avatarConfig.clothingId ? resolvedImages[avatarConfig.clothingId] : null;
  const eyesData = avatarConfig.eyesId ? resolvedImages[avatarConfig.eyesId] : null;
  const mouthData = avatarConfig.mouthId ? resolvedImages[avatarConfig.mouthId] : null;
  const hairData = avatarConfig.hairId ? resolvedImages[avatarConfig.hairId] : null;
  const hatData = avatarConfig.hatId ? resolvedImages[avatarConfig.hatId] : null;
  const accessoryData = avatarConfig.accessoryId ? resolvedImages[avatarConfig.accessoryId] : null;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <clipPath id="chip-circle">
      <circle cx="64" cy="64" r="60"/>
    </clipPath>
    <linearGradient id="chip-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    ${avatarConfig.tintColor ? buildTintFilterDef('chip-tint', avatarConfig.tintColor) : ''}
  </defs>

  <g clip-path="url(#chip-circle)">
    <!-- Base background circle -->
    <rect width="128" height="128" fill="url(#chip-bg)"/>

    <!-- Avatar Layer Stack -->
    ${
      silhouetteData
        ? `<image href="${silhouetteData}" x="16" y="16" width="96" height="96" ${
            avatarConfig.tintColor ? 'filter="url(#chip-tint)"' : ''
          }/>`
        : `<!-- Neutral Silhouette Fallback -->
           <circle cx="64" cy="50" r="22" fill="${escapeXml(tint)}"/>
           <ellipse cx="64" cy="94" rx="34" ry="24" fill="${escapeXml(tint)}"/>`
    }
    ${clothingData ? `<image href="${clothingData}" x="16" y="16" width="96" height="96" />` : ''}
    ${eyesData ? `<image href="${eyesData}" x="16" y="16" width="96" height="96" />` : ''}
    ${mouthData ? `<image href="${mouthData}" x="16" y="16" width="96" height="96" />` : ''}
    ${hairData ? `<image href="${hairData}" x="16" y="16" width="96" height="96" />` : ''}
    ${hatData ? `<image href="${hatData}" x="16" y="16" width="96" height="96" />` : ''}
    ${accessoryData ? `<image href="${accessoryData}" x="16" y="16" width="96" height="96" />` : ''}
  </g>

  <!-- Circular Badge Border -->
  <circle cx="64" cy="64" r="60" fill="none" stroke="${escapeXml(tint)}" stroke-width="4" stroke-opacity="0.8"/>
</svg>`.trim();
}

/**
 * Builds the 512×512 framed avatar profile card SVG.
 */
export function buildProfileSvg(
  avatarConfig: AvatarConfig,
  frameId: string,
  backgroundId: string,
  critters: CritterConfig[],
  resolvedImages: Record<string, string>
): string {
  const tint = avatarConfig.tintColor || '#38bdf8';
  const bgData = backgroundId ? resolvedImages[backgroundId] : null;
  const frameData = frameId ? resolvedImages[frameId] : null;
  const silhouetteData = resolvedImages[avatarConfig.silhouetteId];
  const clothingData = avatarConfig.clothingId ? resolvedImages[avatarConfig.clothingId] : null;
  const eyesData = avatarConfig.eyesId ? resolvedImages[avatarConfig.eyesId] : null;
  const mouthData = avatarConfig.mouthId ? resolvedImages[avatarConfig.mouthId] : null;
  const hairData = avatarConfig.hairId ? resolvedImages[avatarConfig.hairId] : null;
  const hatData = avatarConfig.hatId ? resolvedImages[avatarConfig.hatId] : null;
  const accessoryData = avatarConfig.accessoryId ? resolvedImages[avatarConfig.accessoryId] : null;
  const handRigData = avatarConfig.handRigId ? resolvedImages[avatarConfig.handRigId] : null;

  // Critter placement logic
  const critterSvgs = critters
    .map((c) => {
      const cData = resolvedImages[c.critterId];
      if (!cData) return '';
      let cx = 350;
      let cy = 180;
      let cw = 110;
      let ch = 110;

      switch (c.perchLocation) {
        case 'shoulder':
          cx = 330;
          cy = 200;
          break;
        case 'pocket':
          cx = 320;
          cy = 320;
          cw = 85;
          ch = 85;
          break;
        case 'hover':
          cx = 80;
          cy = 120;
          break;
        case 'ground':
          cx = 360;
          cy = 380;
          break;
      }
      return `<image href="${cData}" x="${cx}" y="${cy}" width="${cw}" height="${ch}" />`;
    })
    .join('\n');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="profile-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b0f19"/>
      <stop offset="100%" stop-color="#1a2234"/>
    </linearGradient>
    ${avatarConfig.tintColor ? buildTintFilterDef('profile-tint', avatarConfig.tintColor) : ''}
  </defs>

  <!-- Background Layer -->
  ${
    bgData
      ? `<image href="${bgData}" x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="512" height="512" fill="url(#profile-bg)"/>`
  }

  <!-- Avatar Silhouette & Garments -->
  <g id="avatar-rig">
    ${
      silhouetteData
        ? `<image href="${silhouetteData}" x="56" y="56" width="400" height="400" ${
            avatarConfig.tintColor ? 'filter="url(#profile-tint)"' : ''
          }/>`
        : `<!-- Vector Silhouette Fallback -->
           <circle cx="256" cy="200" r="88" fill="${escapeXml(tint)}"/>
           <ellipse cx="256" cy="380" rx="140" ry="100" fill="${escapeXml(tint)}"/>`
    }
    ${clothingData ? `<image href="${clothingData}" x="56" y="56" width="400" height="400" />` : ''}
    ${eyesData ? `<image href="${eyesData}" x="56" y="56" width="400" height="400" />` : ''}
    ${mouthData ? `<image href="${mouthData}" x="56" y="56" width="400" height="400" />` : ''}
    ${hairData ? `<image href="${hairData}" x="56" y="56" width="400" height="400" />` : ''}
    ${hatData ? `<image href="${hatData}" x="56" y="56" width="400" height="400" />` : ''}
    ${accessoryData ? `<image href="${accessoryData}" x="56" y="56" width="400" height="400" />` : ''}
    ${handRigData ? `<image href="${handRigData}" x="56" y="56" width="400" height="400" />` : ''}
  </g>

  <!-- Attached Critters -->
  ${critterSvgs}

  <!-- Rarity Frame HUD Overlay -->
  ${
    frameData
      ? `<image href="${frameData}" x="0" y="0" width="512" height="512" />`
      : `<rect x="8" y="8" width="496" height="496" rx="24" fill="none" stroke="rgba(99, 102, 241, 0.4)" stroke-width="8"/>`
  }
</svg>`.trim();
}

/**
 * Builds the 1920×1080 (1080p) flattened habitat scene SVG.
 */
export function buildLandscapeSvg(
  avatarConfig: AvatarConfig,
  landscapeConfig: LandscapeConfig,
  critters: CritterConfig[],
  resolvedImages: Record<string, string>
): string {
  const landscapeData = landscapeConfig.landscapeId
    ? resolvedImages[landscapeConfig.landscapeId]
    : null;
  const isNight = landscapeConfig.theme === 'night';
  const coords = landscapeConfig.anchorCoordinates || { x: 0.5, y: 0.75 };

  // Calculate pixel anchor in 1920×1080 space
  const avatarWidth = 480;
  const avatarHeight = 480;
  const posX = Math.round(coords.x * 1920 - avatarWidth / 2);
  const posY = Math.round(coords.y * 1080 - avatarHeight * 0.85);

  const tint = avatarConfig.tintColor || '#38bdf8';
  const silhouetteData = resolvedImages[avatarConfig.silhouetteId];
  const clothingData = avatarConfig.clothingId ? resolvedImages[avatarConfig.clothingId] : null;
  const eyesData = avatarConfig.eyesId ? resolvedImages[avatarConfig.eyesId] : null;
  const mouthData = avatarConfig.mouthId ? resolvedImages[avatarConfig.mouthId] : null;
  const hairData = avatarConfig.hairId ? resolvedImages[avatarConfig.hairId] : null;
  const hatData = avatarConfig.hatId ? resolvedImages[avatarConfig.hatId] : null;
  const accessoryData = avatarConfig.accessoryId ? resolvedImages[avatarConfig.accessoryId] : null;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="landscape-day-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#bae6fd"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <linearGradient id="landscape-night-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="60%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    ${avatarConfig.tintColor ? buildTintFilterDef('landscape-tint', avatarConfig.tintColor) : ''}
  </defs>

  <!-- Habitat Landscape Scene -->
  ${
    landscapeData
      ? `<image href="${landscapeData}" x="0" y="0" width="1920" height="1080" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="1920" height="1080" fill="url(${isNight ? '#landscape-night-sky' : '#landscape-day-sky'})"/>
         <ellipse cx="960" cy="980" rx="900" ry="240" fill="${isNight ? '#064e3b' : '#15803d'}"/>`
  }

  <!-- Time of Day Atmospheric Overlay -->
  ${
    isNight
      ? `<rect width="1920" height="1080" fill="#020617" opacity="0.38"/>`
      : `<rect width="1920" height="1080" fill="#fef08a" opacity="0.06"/>`
  }

  <!-- Anchored Avatar Composite in Habitat -->
  <g transform="translate(${posX}, ${posY})">
    ${
      silhouetteData
        ? `<image href="${silhouetteData}" x="0" y="0" width="${avatarWidth}" height="${avatarHeight}" ${
            avatarConfig.tintColor ? 'filter="url(#landscape-tint)"' : ''
          }/>`
        : `<circle cx="${avatarWidth / 2}" cy="${avatarHeight * 0.4}" r="${avatarWidth * 0.18}" fill="${escapeXml(tint)}"/>
           <ellipse cx="${avatarWidth / 2}" cy="${avatarHeight * 0.8}" rx="${avatarWidth * 0.28}" ry="${avatarHeight * 0.22}" fill="${escapeXml(tint)}"/>`
    }
    ${clothingData ? `<image href="${clothingData}" x="0" y="0" width="${avatarWidth}" height="${avatarHeight}" />` : ''}
    ${eyesData ? `<image href="${eyesData}" x="0" y="0" width="${avatarWidth}" height="${avatarHeight}" />` : ''}
    ${mouthData ? `<image href="${mouthData}" x="0" y="0" width="${avatarWidth}" height="${avatarHeight}" />` : ''}
    ${hairData ? `<image href="${hairData}" x="0" y="0" width="${avatarWidth}" height="${avatarHeight}" />` : ''}
    ${hatData ? `<image href="${hatData}" x="0" y="0" width="${avatarWidth}" height="${avatarHeight}" />` : ''}
    ${accessoryData ? `<image href="${accessoryData}" x="0" y="0" width="${avatarWidth}" height="${avatarHeight}" />` : ''}

    <!-- Critters on Scene -->
    ${critters
      .map((c, i) => {
        const cData = resolvedImages[c.critterId];
        if (!cData) return '';
        const offset = (i + 1) * 90;
        return `<image href="${cData}" x="${avatarWidth - 40 + offset}" y="${avatarHeight * 0.5}" width="120" height="120" />`;
      })
      .join('\n')}
  </g>
</svg>`.trim();
}

/**
 * Builds an SVG from an explicit CompositeManifest.
 */
export function buildCustomManifestSvg(
  manifest: CompositeManifest,
  resolvedImages: Record<string, string>,
  targetWidth?: number,
  targetHeight?: number
): string {
  const sortedLayers = [...manifest.layers].sort((a, b) => a.zIndex - b.zIndex);
  const width = targetWidth || manifest.outputWidth || 512;
  const height = targetHeight || manifest.outputHeight || 512;
  const viewBox = `0 0 ${manifest.outputWidth || width} ${manifest.outputHeight || height}`;

  const layerSvgs = sortedLayers
    .map((layer) => {
      const imgData = resolvedImages[layer.itemId];
      if (!imgData) return '';
      return `<image href="${imgData}" x="${layer.bounds.x}" y="${layer.bounds.y}" width="${layer.bounds.width}" height="${layer.bounds.height}" opacity="${layer.opacity ?? 1}" />`;
    })
    .join('\n');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">
  ${layerSvgs}
</svg>`.trim();
}

// ──────────────────────────────────────────────
// Target Rasterization & WebP Encoding
// ──────────────────────────────────────────────

export async function renderSvgToWebp(
  svg: string,
  width: number,
  _height?: number,
  quality = 90,
  env?: Env
): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
  await ensureWasmInitialized(env);

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    shapeRendering: 0,
    textRendering: 0,
    imageRendering: 1,
  });

  const rendered = resvg.render();
  const pixels = rendered.pixels;
  const outWidth = rendered.width;
  const outHeight = rendered.height;

  // Encode raw RGBA pixels into WebP via WebAssembly with fast method 0 (<800ms edge SLA)
  const imageDataLike = {
    data: new Uint8ClampedArray(pixels),
    width: outWidth,
    height: outHeight,
    colorSpace: 'srgb' as PredefinedColorSpace,
  } as ImageData;

  const webpBuffer = await encodeWebp(imageDataLike, {
    quality: Math.min(quality, 85),
    method: 0,
    segments: 1,
    filter_strength: 0,
  });

  return {
    buffer: webpBuffer,
    width: outWidth,
    height: outHeight,
  };
}

// ──────────────────────────────────────────────
// Hub Database Sync Helper
// ──────────────────────────────────────────────

export async function updateHubUserLoadout(
  userId: string,
  renderUrls: RenderUrls,
  loadoutPayload: Partial<UserCosmeticLoadout>,
  env?: Env
): Promise<{ success: boolean; error?: string }> {
  const supabaseUrl = env?.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    env?.SUPABASE_SERVICE_ROLE_KEY ||
    env?.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { success: false, error: 'Supabase credentials not configured in environment' };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const fullLoadout = {
      ...loadoutPayload,
      userId,
      renderUrls,
    };

    const { error } = await supabase
      .schema('hub')
      .from('user_cosmetic_loadouts')
      .upsert({
        user_id: userId,
        loadout: fullLoadout,
        render_chip_url: renderUrls.chip,
        render_profile_url: renderUrls.profile,
        render_landscape_url: renderUrls.landscape,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.warn('[prerender] Failed to upsert hub.user_cosmetic_loadouts:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    console.warn('[prerender] Supabase error during loadout sync:', msg);
    return { success: false, error: msg };
  }
}

// ──────────────────────────────────────────────
// Main Prerender HTTP Handler
// ──────────────────────────────────────────────

export async function handlePrerenderRequest(request: Request, env?: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const corsHeaders = getPrerenderCorsHeaders(origin);

  // Handle preflight OPTIONS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const startTime = performance.now();

  // 1. Parse Request Body
  let body: PrerenderRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Bad Request: Malformed JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = body.userId;
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return new Response(JSON.stringify({ error: 'Bad Request: Missing or invalid userId' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Authentication Check
  const authResult = await verifyAuth(request, userId, env);
  if (!authResult.authorized) {
    const status = authResult.error?.startsWith('Forbidden') ? 403 : 401;
    return new Response(JSON.stringify({ error: authResult.error }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const bucket = env?.AVATAR_BUCKET || env?.BUCKET;
  if (!bucket) {
    return new Response(
      JSON.stringify({ error: 'Service Unavailable: R2 AVATAR_BUCKET binding missing' }),
      {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const version = body.version && body.version > 0 ? body.version : Date.now();
  const quality = body.quality || 90;
  const cdnBase = (env?.PUBLIC_CDN_URL || 'https://assets.sunshade.icu').replace(/\/+$/, '');

  // Extract loadout config
  const rawLoadout = body.loadout || {};
  const avatarConfig: AvatarConfig =
    body.avatarConfig || rawLoadout.avatarConfig || { silhouetteId: '' };
  const frameId: string = body.frameId || rawLoadout.frameId || '';
  const backgroundId: string = body.backgroundId || rawLoadout.backgroundId || '';
  // Clamp critters to reasonable ceiling (SEC_0004)
  const critters: CritterConfig[] = (body.critters || rawLoadout.critters || []).slice(0, 8);
  const landscapeConfig: LandscapeConfig = body.landscapeConfig ||
    rawLoadout.landscapeConfig || {
      landscapeId: '',
      anchorCoordinates: { x: 0.5, y: 0.75 },
      theme: 'day',
    };

  // 3. Collect & Fetch source layer assets from R2 private asset prefix
  const assetIdsToFetch = new Set<string>();
  if (avatarConfig.silhouetteId) assetIdsToFetch.add(avatarConfig.silhouetteId);
  if (avatarConfig.clothingId) assetIdsToFetch.add(avatarConfig.clothingId);
  if (avatarConfig.eyesId) assetIdsToFetch.add(avatarConfig.eyesId);
  if (avatarConfig.mouthId) assetIdsToFetch.add(avatarConfig.mouthId);
  if (avatarConfig.hairId) assetIdsToFetch.add(avatarConfig.hairId);
  if (avatarConfig.hatId) assetIdsToFetch.add(avatarConfig.hatId);
  if (avatarConfig.accessoryId) assetIdsToFetch.add(avatarConfig.accessoryId);
  if (avatarConfig.handRigId) assetIdsToFetch.add(avatarConfig.handRigId);
  if (frameId) assetIdsToFetch.add(frameId);
  if (backgroundId) assetIdsToFetch.add(backgroundId);
  if (landscapeConfig.landscapeId) assetIdsToFetch.add(landscapeConfig.landscapeId);
  for (const c of critters) {
    if (c.critterId) assetIdsToFetch.add(c.critterId);
  }

  if (body.manifest?.layers) {
    body.manifest.layers = body.manifest.layers.slice(0, 25);
    for (const layer of body.manifest.layers) {
      if (layer.itemId) assetIdsToFetch.add(layer.itemId);
    }
  }

  // Guard against resource exhaustion (SEC_0004)
  if (assetIdsToFetch.size > 25) {
    return new Response(
      JSON.stringify({ error: 'Bad Request: Maximum number of cosmetic assets exceeded (limit: 25)' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const resolvedImages: Record<string, string> = {};
  await Promise.all(
    Array.from(assetIdsToFetch).map(async (id) => {
      const asset = await fetchLayerAsset(id, env, body.assetUrls);
      if (asset) {
        resolvedImages[id] = asset.dataUri;
      }
    })
  );

  // 4. Flatten and composite images into 3 distinct targets using WebAssembly
  // Supports custom manifests when provided (BUG_0004)
  const chipSvg = body.manifest
    ? buildCustomManifestSvg(body.manifest, resolvedImages, 128, 128)
    : buildChipSvg(avatarConfig, resolvedImages, frameId, backgroundId);

  const profileSvg = body.manifest
    ? buildCustomManifestSvg(body.manifest, resolvedImages, 512, 512)
    : buildProfileSvg(avatarConfig, frameId, backgroundId, critters, resolvedImages);

  const landscapeSvg = body.manifest
    ? buildCustomManifestSvg(body.manifest, resolvedImages, 1920, 1080)
    : buildLandscapeSvg(avatarConfig, landscapeConfig, critters, resolvedImages);

  const [chipWebp, profileWebp, landscapeWebp] = await Promise.all([
    renderSvgToWebp(chipSvg, 128, 128, quality, env),
    renderSvgToWebp(profileSvg, 512, 512, quality, env),
    renderSvgToWebp(landscapeSvg, 1920, 1080, quality, env),
  ]);

  // 5. Write composites to R2 public paths: renders/{userId}/{version}/{target}.webp
  const chipKey = `renders/${userId}/${version}/chip.webp`;
  const profileKey = `renders/${userId}/${version}/profile.webp`;
  const landscapeKey = `renders/${userId}/${version}/landscape.webp`;

  const r2PutOptions = (target: string): R2PutOptions => ({
    httpMetadata: {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      userId,
      version: String(version),
      target,
      published: 'true',
      visibility: 'public',
    },
  });

  await Promise.all([
    bucket.put(chipKey, chipWebp.buffer, r2PutOptions('chip')),
    bucket.put(profileKey, profileWebp.buffer, r2PutOptions('profile')),
    bucket.put(landscapeKey, landscapeWebp.buffer, r2PutOptions('landscape')),
  ]);

  const renderUrls: RenderUrls = {
    chip: `${cdnBase}/${chipKey}`,
    profile: `${cdnBase}/${profileKey}`,
    landscape: `${cdnBase}/${landscapeKey}`,
    version,
  };

  // 6. Update hub.user_cosmetic_loadouts with latest render URLs and check result (BUG_0003)
  const syncResult = await updateHubUserLoadout(
    userId,
    renderUrls,
    {
      frameId,
      backgroundId,
      avatarConfig,
      critters,
      landscapeConfig,
    },
    env
  );

  if (env?.SUPABASE_URL && !syncResult.success) {
    return new Response(
      JSON.stringify({
        error: `Failed to synchronize loadout in hub.user_cosmetic_loadouts: ${syncResult.error}`,
        userId,
        version,
        renderUrls,
        persisted: false,
      }),
      {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const durationMs = Math.round(performance.now() - startTime);

  const responsePayload: PrerenderResponseData = {
    success: true,
    userId,
    version,
    renderUrls,
    persisted: syncResult.success,
    targets: {
      chip: {
        size: chipWebp.buffer.byteLength,
        format: 'webp',
        width: chipWebp.width,
        height: chipWebp.height,
        r2Key: chipKey,
        url: renderUrls.chip,
      },
      profile: {
        size: profileWebp.buffer.byteLength,
        format: 'webp',
        width: profileWebp.width,
        height: profileWebp.height,
        r2Key: profileKey,
        url: renderUrls.profile,
      },
      landscape: {
        size: landscapeWebp.buffer.byteLength,
        format: 'webp',
        width: landscapeWebp.width,
        height: landscapeWebp.height,
        r2Key: landscapeKey,
        url: renderUrls.landscape,
      },
    },
    durationMs,
  };

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-Composite-Duration-Ms': String(durationMs),
    },
  });
}

// ──────────────────────────────────────────────
// Cloudflare Pages Functions Standard Exports
// ──────────────────────────────────────────────

export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  return handlePrerenderRequest(context.request, context.env);
}

export async function onRequestOptions(context: {
  request: Request;
}): Promise<Response> {
  const origin = context.request.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: getPrerenderCorsHeaders(origin),
  });
}
