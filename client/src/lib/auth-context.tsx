import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, apiRequest } from './api';
import type { AuthSession, SignupPayload, User } from './types';

const TOKEN_STORAGE_KEY = 'brightloop.auth.token';

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore: the session still works for this tab.
  }
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isBootstrapping: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (payload: SignupPayload) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const applySession = useCallback((session: AuthSession) => {
    writeStoredToken(session.token);
    setToken(session.token);
    setUser(session.user);
  }, []);

  const logout = useCallback(() => {
    writeStoredToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const activeToken = readStoredToken();
    if (!activeToken) {
      setUser(null);
      return;
    }

    try {
      const result = await apiRequest<User>('/auth/me', { token: activeToken });
      setUser(result.data);
      setToken(activeToken);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        logout();
        return;
      }
      throw error;
    }
  }, [logout]);

  // Restore the session once on load so a refresh does not log the user out.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await refreshUser();
      } catch {
        // A network blip should not wipe a valid token; the next call retries.
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiRequest<AuthSession>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      applySession(result.data);
      return result.data.user;
    },
    [applySession],
  );

  const signup = useCallback(
    async (payload: SignupPayload) => {
      const result = await apiRequest<AuthSession>('/auth/signup', {
        method: 'POST',
        body: payload,
      });
      applySession(result.data);
      return result.data.user;
    },
    [applySession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, isBootstrapping, login, signup, logout, refreshUser }),
    [user, token, isBootstrapping, login, signup, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return context;
}
