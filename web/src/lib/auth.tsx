import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { followPrimersId, markPrimersLinked } from './primersFollow';
import { api, clearSession, getStoredUser, getToken, setUnauthorizedHandler, storeSession, type AuthUser } from './api';

interface AuthState {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  /** Finish "Continue with Primers ID" (sign in) or connect it to the signed-in account. */
  primers: (mode: 'signin' | 'link', code: string, verifier: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  // Signing out of Primers ID (in the Primers bar or any Primers site) signs staff out here too if they
  // came in with Primers ID. Switching personal accounts in the bar does not move a staff session.
  useEffect(() => followPrimersId({
    isSignedIn: () => !!getToken(),
    signIn: null,
    signOut: () => { clearSession(); markPrimersLinked(false); setUser(null); },
  }), []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      async login(username, password) {
        const res = await api.post<{ token: string; user: AuthUser }>('/api/auth/login', { username, password });
        storeSession(res.token, res.user);
        markPrimersLinked(false);
        setUser(res.user);
      },
      async primers(mode, code, verifier) {
        const path = mode === 'link' ? '/api/auth/primers/link' : '/api/auth/primers';
        const res = await api.post<{ token?: string; user: AuthUser }>(path, { code, verifier });
        const token = res.token ?? getToken();
        if (!token) throw new Error('Please sign in again.');
        storeSession(token, res.user);
        if (mode === 'signin') markPrimersLinked(true);
        setUser(res.user);
      },
      logout() {
        clearSession();
        markPrimersLinked(false);
        setUser(null);
      }
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
