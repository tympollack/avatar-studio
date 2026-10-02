import {
  stringToBase64URL,
  stringFromBase64URL,
  parseDocumentCookies,
  getCombinedCookieValue,
  createChunks,
  createCookieStorage,
  BASE64_PREFIX,
  MAX_CHUNK_SIZE,
  SSO_DOMAIN,
} from '../src/lib/cookieStorage';

describe('cookieStorage', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;

  afterEach(() => {
    // Restore globals
    if (originalWindow !== undefined) {
      global.window = originalWindow;
    } else {
      delete (global as any).window;
    }
    if (originalDocument !== undefined) {
      global.document = originalDocument;
    } else {
      delete (global as any).document;
    }
  });

  describe('base64url encoding / decoding', () => {
    it('roundtrips ASCII and UTF-8 strings correctly', () => {
      const samples = [
        'hello world',
        JSON.stringify({ access_token: 'tok_123', user: { id: 'u_1', name: 'Avatar \u{1F33F}' } }),
        'special characters: + / = ? & % # @ !',
      ];

      for (const sample of samples) {
        const encoded = stringToBase64URL(sample);
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('=');

        const decoded = stringFromBase64URL(encoded);
        expect(decoded).toBe(sample);
      }
    });
  });

  describe('chunking', () => {
    it('keeps short values in a single chunk', () => {
      const chunks = createChunks('test-key', 'short-value');
      expect(chunks).toEqual([{ name: 'test-key', value: 'short-value' }]);
    });

    it('splits values exceeding MAX_CHUNK_SIZE into numbered chunks', () => {
      const longValue = 'a'.repeat(MAX_CHUNK_SIZE + 500);
      const chunks = createChunks('large-key', longValue);
      expect(chunks.length).toBe(2);
      expect(chunks[0].name).toBe('large-key.0');
      expect(chunks[1].name).toBe('large-key.1');

      // Reconstructed value matches original
      const combined = chunks.map((c) => c.value).join('');
      expect(combined).toBe(longValue);
    });

    it('combines chunked cookies correctly', () => {
      const map = new Map<string, string>([
        ['sb-token.0', 'chunkZero'],
        ['sb-token.1', 'chunkOne'],
      ]);
      expect(getCombinedCookieValue('sb-token', map)).toBe('chunkZerochunkOne');
    });

    it('prefers unchunked cookie if present', () => {
      const map = new Map<string, string>([
        ['sb-token', 'wholeValue'],
        ['sb-token.0', 'ignoredChunk'],
      ]);
      expect(getCombinedCookieValue('sb-token', map)).toBe('wholeValue');
    });
  });

  describe('createCookieStorage in mock browser environment', () => {
    let mockCookie = '';
    let mockLocalStorage: Record<string, string> = {};

    beforeEach(() => {
      mockCookie = '';
      mockLocalStorage = {};

      // Setup mock window & document
      (global as any).window = {
        location: {
          hostname: 'avatar.sunshade.icu',
          protocol: 'https:',
        },
        localStorage: {
          getItem: (k: string) => mockLocalStorage[k] ?? null,
          setItem: (k: string, v: string) => {
            mockLocalStorage[k] = v;
          },
          removeItem: (k: string) => {
            delete mockLocalStorage[k];
          },
        },
      };

      (global as any).document = {
        get cookie() {
          return mockCookie;
        },
        set cookie(val: string) {
          // Emulate standard browser cookie setter: single cookie string
          const [cookiePart] = val.split(';');
          const [name, ...valParts] = cookiePart.split('=');
          const trimmedName = name.trim();
          const cookieVal = valParts.join('=');

          const isExpire = /Max-Age=0/i.test(val) || /Expires=Thu, 01 Jan 1970/i.test(val);

          const existing = parseDocumentCookies();
          if (isExpire) {
            existing.delete(trimmedName);
          } else {
            existing.set(trimmedName, decodeURIComponent(cookieVal));
          }

          mockCookie = Array.from(existing.entries())
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('; ');
        },
      };
    });

    it('reads Hub session cookie serialized with base64- prefix', () => {
      const storage = createCookieStorage();
      const sessionPayload = {
        access_token: 'hub_access_token_xyz',
        refresh_token: 'hub_refresh_token_abc',
        user: { id: 'usr_123', email: 'pilot@sunshade.icu' },
      };
      const sessionJson = JSON.stringify(sessionPayload);
      const encodedCookie = `${BASE64_PREFIX}${stringToBase64URL(sessionJson)}`;

      // Simulate Hub cookie set on .sunshade.icu
      document.cookie = `sb-projectref-auth-token=${encodeURIComponent(encodedCookie)}; domain=.sunshade.icu; path=/`;

      const readSession = storage.getItem('sb-projectref-auth-token');
      expect(readSession).toBe(sessionJson);
      expect(JSON.parse(readSession!)).toEqual(sessionPayload);
    });

    it('writes session cookie and mirrors to localStorage', () => {
      const storage = createCookieStorage();
      const sessionPayload = {
        access_token: 'new_token_456',
        user: { id: 'usr_456' },
      };
      const sessionJson = JSON.stringify(sessionPayload);

      storage.setItem('sb-projectref-auth-token', sessionJson);

      // Verify cookie is set
      const readVal = storage.getItem('sb-projectref-auth-token');
      expect(readVal).toBe(sessionJson);

      // Verify localStorage was also updated
      expect(mockLocalStorage['sb-projectref-auth-token']).toBe(sessionJson);
    });

    it('removes cookie and localStorage on removeItem', () => {
      const storage = createCookieStorage();
      storage.setItem('sb-projectref-auth-token', '{"token":"123"}');
      expect(storage.getItem('sb-projectref-auth-token')).toBe('{"token":"123"}');

      storage.removeItem('sb-projectref-auth-token');
      expect(storage.getItem('sb-projectref-auth-token')).toBeNull();
      expect(mockLocalStorage['sb-projectref-auth-token']).toBeUndefined();
    });

    it('falls back to localStorage if cookie is not set', () => {
      const storage = createCookieStorage();
      mockLocalStorage['sb-projectref-auth-token'] = '{"local":true}';

      expect(storage.getItem('sb-projectref-auth-token')).toBe('{"local":true}');
    });

    it('clears stale chunks when a new smaller session overwrites a chunked session', () => {
      const storage = createCookieStorage();
      // Write large chunked session
      const bigSession = JSON.stringify({ data: 'x'.repeat(4000) });
      storage.setItem('sb-token', bigSession);
      expect(mockCookie).toContain('sb-token.0');
      expect(mockCookie).toContain('sb-token.1');

      // Overwrite with small session
      const smallSession = JSON.stringify({ data: 'small' });
      storage.setItem('sb-token', smallSession);

      // Old chunks should be cleared
      expect(mockCookie).not.toContain('sb-token.1');
      expect(storage.getItem('sb-token')).toBe(smallSession);
    });
  });

  describe('SSR / Non-browser environment safety', () => {
    beforeEach(() => {
      delete (global as any).window;
      delete (global as any).document;
    });

    it('safely returns null without throwing when window/document are absent', () => {
      const storage = createCookieStorage();
      expect(storage.getItem('sb-token')).toBeNull();
      expect(() => storage.setItem('sb-token', '{}')).not.toThrow();
      expect(() => storage.removeItem('sb-token')).not.toThrow();
    });
  });
});
