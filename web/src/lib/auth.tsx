import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearSession, getStoredUser, setUnauthorizedHandler, storeSession, type AuthUser } from './api';

interface AuthState {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      async login(username, password) {
        const res = await api.post<{ token: string; user: AuthUser }>('/api/auth/login', { username, password });
        storeSession(res.token, res.user);
        setUser(res.user);
      },
      logout() {
        clearSession();
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
