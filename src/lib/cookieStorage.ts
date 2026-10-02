/**
 * @module lib/cookieStorage
 *
 * Custom cookie-based AuthStorage adapter for @supabase/supabase-js.
 *
 * Fully compatible with @supabase/ssr and SunShade Hub's session cookies:
 * - Reads and writes shared cookies across *.sunshade.icu subdomains.
 * - Matches @supabase/ssr session serialization ('base64-' prefix + base64url string).
 * - Preserves plain-string auth values (e.g. PKCE code verifiers) without requiring JSON format.
 * - Handles chunked cookies (key.0, key.1, etc.) for sessions exceeding MAX_CHUNK_SIZE.
 * - Manages cookie domain scoping (.sunshade.icu on SunShade domains, host-only on localhost/previews).
 * - Proactively clears host-only cookies before setting domain cookies to prevent cookie shadowing.
 * - Clears both domain-scoped and host-only cookies on sign-out to prevent session resurrection.
 */

import type { SupportedStorage } from '@supabase/supabase-js';

export const SSO_DOMAIN = '.sunshade.icu';
export const BASE64_PREFIX = 'base64-';
export const MAX_CHUNK_SIZE = 3180;
export const DEFAULT_MAX_AGE = 400 * 24 * 60 * 60; // 400 days in seconds

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function isSunShadeDomain(): boolean {
  if (!isBrowser()) return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'sunshade.icu' || host.endsWith('.sunshade.icu');
}

/**
 * Base64URL encode a UTF-8 string.
 */
export function stringToBase64URL(str: string): string {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64URL decode to a UTF-8 string.
 */
export function stringFromBase64URL(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Parse all cookies from document.cookie into a Map of name -> decoded value.
 *
 * If duplicate cookie names exist in document.cookie (e.g. from a legacy host-only
 * cookie and a shared-domain cookie), prefers the base64-prefixed session value.
 */
export function parseDocumentCookies(): Map<string, string> {
  const cookieMap = new Map<string, string>();
  if (!isBrowser() || !document.cookie) return cookieMap;

  const parts = document.cookie.split('; ');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }

    if (cookieMap.has(name)) {
      const existing = cookieMap.get(name)!;
      // Prefer base64-prefixed session values over legacy plain text
      if (existing.startsWith(BASE64_PREFIX)) {
        continue;
      }
    }

    cookieMap.set(name, decoded);
  }
  return cookieMap;
}

/**
 * Combine chunked cookies matching key or key.0, key.1, etc.
 */
export function getCombinedCookieValue(key: string, cookies: Map<string, string>): string | null {
  if (cookies.has(key)) {
    return cookies.get(key)!;
  }

  if (!cookies.has(`${key}.0`)) {
    return null;
  }

  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunkName = `${key}.${i}`;
    const chunk = cookies.get(chunkName);
    if (chunk === undefined) break;
    chunks.push(chunk);
  }

  return chunks.length > 0 ? chunks.join('') : null;
}

/**
 * Create chunks from a string if its URI-encoded length exceeds MAX_CHUNK_SIZE.
 */
export function createChunks(key: string, value: string): Array<{ name: string; value: string }> {
  const encoded = encodeURIComponent(value);
  if (encoded.length <= MAX_CHUNK_SIZE) {
    return [{ name: key, value }];
  }

  const chunks: string[] = [];
  let remaining = encoded;

  while (remaining.length > 0) {
    let head = remaining.slice(0, MAX_CHUNK_SIZE);
    const lastPercent = head.lastIndexOf('%');
    if (lastPercent > MAX_CHUNK_SIZE - 3) {
      head = head.slice(0, lastPercent);
    }

    let decodedHead = '';
    while (head.length > 0) {
      try {
        decodedHead = decodeURIComponent(head);
        break;
      } catch (err) {
        if (err instanceof URIError && head.length > 3 && head.at(-3) === '%') {
          head = head.slice(0, head.length - 3);
        } else {
          throw err;
        }
      }
    }

    chunks.push(decodedHead);
    remaining = remaining.slice(head.length);
  }

  return chunks.map((chunkVal, idx) => ({
    name: `${key}.${idx}`,
    value: chunkVal,
  }));
}

/**
 * Format a Set-Cookie string for document.cookie.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: {
    domain?: string;
    path?: string;
    maxAge?: number;
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
    expires?: Date;
  } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Expire a host-only cookie by name (without domain attribute).
 */
export function expireHostOnlyCookie(name: string): void {
  if (!isBrowser()) return;

  const expireOptions = {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    sameSite: 'Lax' as const,
    secure: window.location.protocol === 'https:',
  };

  document.cookie = serializeCookie(name, '', expireOptions);
}

/**
 * Expire a domain-scoped cookie by name (with Domain=.sunshade.icu).
 */
export function expireDomainCookie(name: string): void {
  if (!isBrowser()) return;

  const expireOptions = {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    domain: SSO_DOMAIN,
    sameSite: 'Lax' as const,
    secure: window.location.protocol === 'https:',
  };

  document.cookie = serializeCookie(name, '', expireOptions);
}

/**
 * Expire a cookie by name across both host-only and domain scopes.
 */
export function expireCookie(name: string): void {
  expireHostOnlyCookie(name);
  if (isSunShadeDomain()) {
    expireDomainCookie(name);
  }
}

/**
 * Creates a SupportedStorage adapter for @supabase/supabase-js.
 */
export function createCookieStorage(): SupportedStorage {
  return {
    getItem: (key: string): string | null => {
      if (!isBrowser()) return null;

      const cookies = parseDocumentCookies();
      const rawCombined = getCombinedCookieValue(key, cookies);

      if (!rawCombined) {
        return null;
      }

      // Check for base64- prefix (written by @supabase/ssr / Hub)
      if (rawCombined.startsWith(BASE64_PREFIX)) {
        try {
          return stringFromBase64URL(rawCombined.slice(BASE64_PREFIX.length));
        } catch (err) {
          console.warn('[cookieStorage] Failed to decode base64url cookie value:', err);
          return null;
        }
      }

      // Plain unencoded string (e.g. legacy or unencoded values)
      return rawCombined;
    },

    setItem: (key: string, value: string): void => {
      if (!isBrowser()) return;

      const isHttps = window.location.protocol === 'https:';
      const onSunShade = isSunShadeDomain();
      const domain = onSunShade ? SSO_DOMAIN : undefined;

      // Encode matching @supabase/ssr conventions
      const encoded = BASE64_PREFIX + stringToBase64URL(value);
      const chunks = createChunks(key, encoded);

      // Find any existing chunk cookies to clean up stale remnants
      const existingCookies = parseDocumentCookies();
      const chunkLikeRegex = new RegExp(`^${key}(\\.\\d+)?$`);
      const existingMatchingNames = Array.from(existingCookies.keys()).filter((name) =>
        chunkLikeRegex.test(name)
      );

      const newChunkNames = new Set(chunks.map((c) => c.name));
      const staleChunkNames = existingMatchingNames.filter((name) => !newChunkNames.has(name));

      // Remove stale chunks in both scopes
      for (const staleName of staleChunkNames) {
        expireCookie(staleName);
      }

      // Set new chunks
      for (const chunk of chunks) {
        // When on a SunShade host, explicitly expire any matching host-only cookie first
        // so it cannot shadow the domain-scoped cookie in document.cookie.
        if (onSunShade) {
          expireHostOnlyCookie(chunk.name);
        }

        document.cookie = serializeCookie(chunk.name, chunk.value, {
          path: '/',
          maxAge: DEFAULT_MAX_AGE,
          domain,
          sameSite: 'Lax',
          secure: isHttps,
        });
      }
    },

    removeItem: (key: string): void => {
      if (!isBrowser()) return;

      const existingCookies = parseDocumentCookies();
      const chunkLikeRegex = new RegExp(`^${key}(\\.\\d+)?$`);
      const matchingNames = Array.from(existingCookies.keys()).filter((name) =>
        chunkLikeRegex.test(name)
      );

      // Always expire the unchunked key in both scopes
      expireCookie(key);

      // Expire any numbered chunks in both scopes
      for (const name of matchingNames) {
        expireCookie(name);
      }
    },
  };
}
