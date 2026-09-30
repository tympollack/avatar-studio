import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '@digitalcanopy/supabase';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AuthContextValue {
  /** Active session or null if unauthenticated (guest mode). */
  session: Session | null;
  /** True while the initial session check is in flight. */
  loading: boolean;
  /** Sign out the current user. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * AuthProvider resolves the Supabase session on mount by reading the shared
 * .sunshade.icu cookie via the @digitalcanopy/supabase singleton client.
 *
 * No login redirect is issued — unauthenticated users enter the studio in
 * guest (sandbox) mode and see an "Authenticate with Hub to Save" CTA.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Attempt to read an existing cookie-based session from .sunshade.icu
    supabase.auth
      .getSession()
      .then(({ data, error }: { data: { session: Session | null }; error: Error | null }) => {
        if (!mounted) return;
        if (error) {
          console.error('[AuthProvider] getSession error:', error.message);
        }
        setSession(data?.session ?? null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    // Keep session state in sync with Supabase auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, updatedSession: Session | null) => {
        if (mounted) setSession(updatedSession);
      },
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[AuthProvider] signOut error:', error.message);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, signOut }),
    [session, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useAuth — consume the AuthContext within any component inside AuthProvider.
 *
 * Throws if called outside of an AuthProvider tree.
 */
export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
};
