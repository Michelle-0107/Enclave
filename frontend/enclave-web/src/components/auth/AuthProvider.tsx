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
  ready: boolean;
  error: string;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const token = await getValidAccessToken();
        if (token) {
          const current = await getCurrentUser();
          await getManagementAccess();
          if (mounted) setUser(current);
        }
      } catch (reason) {
        if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
          clearAuthSession();
          if (mounted) setUser(null);
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

    try {
      const current = await getCurrentUser();
      await getManagementAccess();
      setUser(current);
      setReady(true);
    } catch (reason) {
      clearAuthSession();
      setUser(null);

      if (reason instanceof ApiError && reason.status === 403) {
        throw new Error(
          'This account signed in successfully but does not have the management role in Enclave.',
        );
      }

      throw reason;
    }
  }, []);

  const signOut = useCallback(() => {
    clearAuthSession();
    setUser(null);
    setError('');
  }, []);

  const value = useMemo(
    () => ({ user, ready, error, signIn, signOut }),
    [user, ready, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
