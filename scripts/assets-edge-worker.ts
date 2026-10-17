/**
 * @module scripts/assets-edge-worker
 *
 * Cloudflare Worker / Edge Router for assets.sunshade.icu.
 *
 * Deployment Note:
 * This worker runs independently at the Cloudflare edge to serve public assets from the `sunshade-assets`
 * R2 bucket. It is provisioned and deployed via Cloudflare Workers CLI (`wrangler deploy`)
 * with the `BUCKET` R2 binding configured in the Cloudflare Dashboard / wrangler.toml.
 * The core `avatar-studio` application is deployed separately to Cloudflare Pages.
 *
 * Fronts the Cloudflare R2 bucket `sunshade-assets`, ensuring:
 * 1. Preflight OPTIONS requests respond immediately with HTTP 204 and standard CORS headers.
 * 2. GET/HEAD asset requests from allowed origins (avatar.sunshade.icu, hub.sunshade.icu,
 *    cozy.sunshade.icu, localhost) receive permissive CORS response headers.
 * 3. Strict public taxonomy and safe asset extensions prevent unauthorized access to unpublished objects.
 */

export interface Env {
  BUCKET?: {
    get: (key: string) => Promise<any>;
    head: (key: string) => Promise<any>;
  };
}

export const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/avatar\.sunshade\.icu$/,
  /^https:\/\/hub\.sunshade\.icu$/,
  /^https:\/\/cozy\.sunshade\.icu$/,
  /^http:\/\/localhost(:\d+)?$/,
];

export const PUBLIC_ASSET_REGEX =
  /^(?:assets\/)?(?:kenney|avatar|critters|landscapes|frames|backgrounds)\/[a-zA-Z0-9_\-\/ ]+\.(?:png|svg|webp|jpe?g|gif|json|woff2?|mp3|ogg|wav)$/i;

export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function isPublicAssetKey(key: string): boolean {
  if (!key || key.includes('..') || key.includes('\0') || /(?:^|\/)\./.test(key)) {
    return false;
  }
  return PUBLIC_ASSET_REGEX.test(key);
}

export function getCorsHeaders(requestOrigin: string | null | undefined): Record<string, string> {
  const allowOrigin =
    requestOrigin && isOriginAllowed(requestOrigin) ? requestOrigin : 'https://avatar.sunshade.icu';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'ETag, Content-Type, Cache-Control',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleOptions(request: Request): Response {
  const origin = request.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function handleAssetRequest(request: Request, env?: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  const url = new URL(request.url);
  let rawPath = url.pathname.replace(/^\/+/, '');
  let key: string;
  try {
    key = decodeURIComponent(rawPath);
  } catch {
    return new Response('Bad Request: Malformed URI encoding', {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Restrict access strictly to validated public asset paths and extensions
  if (!isPublicAssetKey(key)) {
    return new Response('Forbidden: Non-public asset path', {
      status: 403,
      headers: corsHeaders,
    });
  }

  if (!env?.BUCKET) {
    return new Response('R2 bucket binding unavailable', {
      status: 503,
      headers: corsHeaders,
    });
  }

  const object = await (request.method === 'HEAD' ? env.BUCKET.head(key) : env.BUCKET.get(key));
  if (!object) {
    return new Response('Asset Not Found', {
      status: 404,
      headers: corsHeaders,
    });
  }

  const responseHeaders = new Headers();
  object.writeHttpMetadata?.(responseHeaders);
  responseHeaders.set('etag', object.httpEtag ?? '');
  for (const [k, v] of Object.entries(corsHeaders)) {
    responseHeaders.set(k, v);
  }

  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: responseHeaders,
    status: 200,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleAssetRequest(request, env);
  },
};
