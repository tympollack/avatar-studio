import {
  stringToBase64URL,
  stringFromBase64URL,
  parseDocumentCookies,
  getCombinedCookieValue,
  createChunks,
  createCookieStorage,
  selectFresherCookieValue,
  getSessionFreshness,
  BASE64_PREFIX,
  MAX_CHUNK_SIZE,
  SSO_DOMAIN,
} from '../src/lib/cookieStorage';

describe('cookieStorage', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;

  afterEach(() => {
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
        'plain_verifier_token_without_json',
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

  describe('Session Freshness & Duplicate Resolution', () => {
    it('identifies session freshness from expires_at', () => {
      const sessionOld = JSON.stringify({ access_token: 'old', expires_at: 1000 });
      const sessionNew = JSON.stringify({ access_token: 'new', expires_at: 2000 });
      const encodedOld = `${BASE64_PREFIX}${stringToBase64URL(sessionOld)}`;
      const encodedNew = `${BASE64_PREFIX}${stringToBase64URL(sessionNew)}`;

      expect(getSessionFreshness(encodedOld)).toBe(1000);
      expect(getSessionFreshness(encodedNew)).toBe(2000);

      // Selects newer session regardless of argument order
      expect(selectFresherCookieValue(encodedOld, encodedNew)).toBe(encodedNew);
      expect(selectFresherCookieValue(encodedNew, encodedOld)).toBe(encodedNew);
    });
  });

  describe('Scoped cookie jar mock (host-only vs domain-scoped)', () => {
    interface CookieJarEntry {
      name: string;
      value: string;
      domain?: string;
      path: string;
    }

    let cookieJar: CookieJarEntry[] = [];
    let emitReversedOrder = false;

    beforeEach(() => {
      cookieJar = [];
      emitReversedOrder = false;

      (global as any).window = {
        location: {
          hostname: 'avatar.sunshade.icu',
          protocol: 'https:',
        },
      };

      (global as any).document = {
        get cookie(): string {
          const currentHost = window.location.hostname.toLowerCase();
          const visible = cookieJar.filter((entry) => {
            if (!entry.domain) {
              return entry.name && currentHost === 'avatar.sunshade.icu';
            }
            const cleanDomain = entry.domain.replace(/^\./, '').toLowerCase();
            return currentHost === cleanDomain || currentHost.endsWith('.' + cleanDomain);
          });

          const entriesToEmit = emitReversedOrder ? [...visible].reverse() : visible;
          return entriesToEmit.map((e) => `${e.name}=${encodeURIComponent(e.value)}`).join('; ');
        },

        set cookie(rawCookieString: string) {
          const parts = rawCookieString.split(';').map((p) => p.trim());
          const [nameVal, ...attrs] = parts;
          const eqIdx = nameVal.indexOf('=');
          const name = eqIdx === -1 ? nameVal : nameVal.slice(0, eqIdx);
          const rawValue = eqIdx === -1 ? '' : nameVal.slice(eqIdx + 1);
          const value = decodeURIComponent(rawValue);

          let domain: string | undefined;
          let path = '/';
          let isExpired = false;

          for (const attr of attrs) {
            const [attrKey, ...attrValParts] = attr.split('=');
            const k = attrKey.toLowerCase().trim();
            const v = attrValParts.join('=').trim();
            if (k === 'domain') {
              domain = v;
            } else if (k === 'path') {
              path = v;
            } else if (k === 'max-age' && Number(v) <= 0) {
              isExpired = true;
            } else if (k === 'expires' && new Date(v).getTime() <= Date.now()) {
              isExpired = true;
            }
          }

          const existingIndex = cookieJar.findIndex((e) => {
            const sameName = e.name === name;
            const samePath = e.path === path;
            const sameDomain =
              (e.domain?.toLowerCase() ?? undefined) === (domain?.toLowerCase() ?? undefined);
            return sameName && samePath && sameDomain;
          });

          if (isExpired) {
            if (existingIndex !== -1) {
              cookieJar.splice(existingIndex, 1);
            }
          } else {
            const entry: CookieJarEntry = { name, value, domain, path };
            if (existingIndex !== -1) {
              cookieJar[existingIndex] = entry;
            } else {
              cookieJar.push(entry);
            }
          }
        },
      };
    });

    it('reads Hub session cookie serialized with base64- prefix', () => {
      const storage = createCookieStorage();
      const sessionPayload = {
        access_token: 'hub_access_token_xyz',
        refresh_token: 'hub_refresh_token_abc',
        expires_at: 2000,
        user: { id: 'usr_123', email: 'pilot@sunshade.icu' },
      };
      const sessionJson = JSON.stringify(sessionPayload);
      const encodedCookie = `${BASE64_PREFIX}${stringToBase64URL(sessionJson)}`;

      // Simulate Hub writing shared .sunshade.icu cookie
      document.cookie = `sb-projectref-auth-token=${encodeURIComponent(encodedCookie)}; Domain=.sunshade.icu; Path=/`;

      const readSession = storage.getItem('sb-projectref-auth-token');
      expect(readSession).toBe(sessionJson);
      expect(JSON.parse(readSession!)).toEqual(sessionPayload);
    });

    it('reads plain-string values (e.g. PKCE code verifiers) without requiring JSON format', () => {
      const storage = createCookieStorage();
      const verifierToken = 'plain_code_verifier_1234567890_abcdef';

      storage.setItem('sb-demo-auth-token-code-verifier', verifierToken);

      const readVal = storage.getItem('sb-demo-auth-token-code-verifier');
      expect(readVal).toBe(verifierToken);
    });

    it('returns null on Hub sign-out without resurrecting from localStorage', () => {
      const storage = createCookieStorage();
      const sessionJson = JSON.stringify({ token: 'active_session', expires_at: 2000 });

      storage.setItem('sb-token', sessionJson);
      expect(storage.getItem('sb-token')).toBe(sessionJson);

      // Hub signs out: removes .sunshade.icu cookie
      document.cookie = `sb-token=; Domain=.sunshade.icu; Path=/; Max-Age=0`;

      // Studio must see null immediately
      expect(storage.getItem('sb-token')).toBeNull();
    });

    describe('Duplicate-name cookie ordering (both orderings tested)', () => {
      const aliceSession = JSON.stringify({ user: { id: 'alice' }, expires_at: 1000 });
      const bobSession = JSON.stringify({ user: { id: 'bob' }, expires_at: 2000 });

      const aliceEncoded = `${BASE64_PREFIX}${stringToBase64URL(aliceSession)}`;
      const bobEncoded = `${BASE64_PREFIX}${stringToBase64URL(bobSession)}`;

      it('Case 1: Host-only Alice appears FIRST, Shared-domain Bob appears SECOND', () => {
        // Alice host-only inserted first
        cookieJar.push({ name: 'sb-token', value: aliceEncoded, path: '/' });
        // Bob domain inserted second
        cookieJar.push({ name: 'sb-token', value: bobEncoded, domain: SSO_DOMAIN, path: '/' });

        emitReversedOrder = false; // [Alice, Bob] in document.cookie
        expect(document.cookie).toContain(aliceEncoded);

        const storage = createCookieStorage();
        const read = storage.getItem('sb-token');

        // Bob's fresher session must be selected
        expect(read).toBe(bobSession);

        // Host-only Alice must be expired and deleted
        expect(cookieJar.some((e) => e.name === 'sb-token' && !e.domain)).toBe(false);
        expect(cookieJar.some((e) => e.name === 'sb-token' && e.domain === SSO_DOMAIN)).toBe(true);
      });

      it('Case 2: Shared-domain Bob appears FIRST, Host-only Alice appears SECOND', () => {
        // Bob domain inserted first
        cookieJar.push({ name: 'sb-token', value: bobEncoded, domain: SSO_DOMAIN, path: '/' });
        // Alice host-only inserted second
        cookieJar.push({ name: 'sb-token', value: aliceEncoded, path: '/' });

        emitReversedOrder = false; // [Bob, Alice] in document.cookie
        const storage = createCookieStorage();
        const read = storage.getItem('sb-token');

        // Bob's fresher session must be selected
        expect(read).toBe(bobSession);

        // Host-only Alice must be expired and deleted
        expect(cookieJar.some((e) => e.name === 'sb-token' && !e.domain)).toBe(false);
        expect(cookieJar.some((e) => e.name === 'sb-token' && e.domain === SSO_DOMAIN)).toBe(true);
      });
    });

    it('clears host-only cookie before writing domain cookie to prevent shadowing', () => {
      const storage = createCookieStorage();

      // Simulate existing host-only cookie for Alice (no Domain attribute)
      document.cookie = `sb-token=${encodeURIComponent(BASE64_PREFIX + stringToBase64URL('alice_session'))}; Path=/`;

      // Verify host-only cookie is initially in the jar
      const hostOnlyEntry = cookieJar.find((e) => e.name === 'sb-token' && !e.domain);
      expect(hostOnlyEntry).toBeDefined();

      // Now Bob signs in: storage.setItem writes domain cookie on SunShade host
      storage.setItem('sb-token', 'bob_session');

      // The host-only cookie must be expired and deleted
      const remainingHostOnly = cookieJar.find((e) => e.name === 'sb-token' && !e.domain);
      expect(remainingHostOnly).toBeUndefined();

      // The domain cookie must be present with Bob's session
      const domainEntry = cookieJar.find((e) => e.name === 'sb-token' && e.domain === SSO_DOMAIN);
      expect(domainEntry).toBeDefined();

      // Reading the session returns Bob, never Alice
      expect(storage.getItem('sb-token')).toBe('bob_session');
    });

    it('clears stale chunks across both scopes when a smaller session is written', () => {
      const storage = createCookieStorage();

      // Write large chunked session
      const bigSession = 'x'.repeat(4000);
      storage.setItem('sb-large', bigSession);

      expect(cookieJar.some((e) => e.name === 'sb-large.0')).toBe(true);
      expect(cookieJar.some((e) => e.name === 'sb-large.1')).toBe(true);

      // Overwrite with small unchunked session
      storage.setItem('sb-large', 'small');

      // Old chunk 1 must be gone
      expect(cookieJar.some((e) => e.name === 'sb-large.1')).toBe(false);
      expect(storage.getItem('sb-large')).toBe('small');
    });

    it('removeItem expires both host-only and domain-scoped cookies', () => {
      const storage = createCookieStorage();
      storage.setItem('sb-token', 'session_data');
      expect(storage.getItem('sb-token')).toBe('session_data');

      storage.removeItem('sb-token');
      expect(storage.getItem('sb-token')).toBeNull();
      expect(cookieJar.length).toBe(0);
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
      expect(() => storage.setItem('sb-token', 'val')).not.toThrow();
      expect(() => storage.removeItem('sb-token')).not.toThrow();
    });
  });
});
