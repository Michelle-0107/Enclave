'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  clearAuthSession,
  getValidAccessToken,
  signInWithPassword,
} from '@/lib/auth-session';
import {
  ApiError,
  getCurrentUser,
  getManagementAccess,
  type CurrentUser,
} from '@/lib/api';

type AuthContextValue = {
  user: CurrentUser | null;
  role: 'management' | 'maintenance' | null;
  ready: boolean;
  error: string;
  signIn: (email: string, password: string) => Promise<'management' | 'maintenance'>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [role, setRole] = useState<'management' | 'maintenance' | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const token = await getValidAccessToken();
        if (token) {
          const current = await getCurrentUser();
          let currentRole: 'management' | 'maintenance' = 'management';
          try {
            await getManagementAccess();
          } catch (reason) {
            if (!(reason instanceof ApiError) || reason.status !== 403) throw reason;
            currentRole = 'maintenance';
          }
          if (mounted) setUser(current);
          if (mounted) setRole(currentRole);
        }
      } catch (reason) {
        if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
          clearAuthSession();
          if (mounted) setUser(null);
          if (mounted) setRole(null);
          if (mounted && reason.status === 403) {
            setError('This account does not have the management role in Enclave.');
          }
        } else if (mounted) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Unable to verify the saved session.',
          );
        }
      } finally {
        if (mounted) setReady(true);
      }
    }

    void restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError('');
    await signInWithPassword(email, password);

    let current: CurrentUser;
    try {
      current = await getCurrentUser();
    } catch (reason) {
      clearAuthSession();
      setUser(null);
      setRole(null);
      throw reason;
    }

    try {
      await getManagementAccess();
      setUser(current);
      setReady(true);
      setRole('management');
      return 'management' as const;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        setUser(current);
        setReady(true);
        setRole('maintenance');
        return 'maintenance' as const;
      }

      clearAuthSession();
      setUser(null);
      setRole(null);
      throw reason;
    }
  }, []);

  const signOut = useCallback(() => {
    clearAuthSession();
    setUser(null);
    setRole(null);
    setError('');
  }, []);

  const value = useMemo(
    () => ({ user, role, ready, error, signIn, signOut }),
    [user, role, ready, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
