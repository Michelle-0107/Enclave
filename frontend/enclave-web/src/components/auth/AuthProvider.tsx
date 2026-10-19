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
  getStaffAccess,
  type CurrentUser,
} from '@/lib/api';

type AuthContextValue = {
  user: CurrentUser | null;
  displayName: string;
  role: 'management' | 'maintenance' | null;
  ready: boolean;
  error: string;
  signIn: (email: string, password: string) => Promise<'management' | 'maintenance'>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [displayName, setDisplayName] = useState('');
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
          const access = await getStaffAccess();
          if (access.user_id !== current.user_id) throw new ApiError('Unable to verify the staff session.', 401);
          if (mounted) setUser(current);
          if (mounted) { setRole(access.role); setDisplayName(access.display_name); }
        }
      } catch (reason) {
        if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
          clearAuthSession();
          if (mounted) setUser(null);
          if (mounted) setRole(null);
          if (mounted && reason.status === 403) {
            setError('An active management or maintenance staff account is required.');
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
      const access = await getStaffAccess();
      if (access.user_id !== current.user_id) throw new ApiError('Unable to verify the staff session.', 401);
      setUser(current);
      setReady(true);
      setRole(access.role);
      setDisplayName(access.display_name);
      return access.role;
    } catch (reason) {
      clearAuthSession();
      setUser(null);
      setRole(null);
      setDisplayName('');
      throw reason;
    }
  }, []);

  const signOut = useCallback(() => {
    clearAuthSession();
    setUser(null);
    setRole(null);
    setDisplayName('');
    setError('');
  }, []);

  const value = useMemo(
    () => ({ user, displayName, role, ready, error, signIn, signOut }),
    [user, displayName, role, ready, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
