'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ApiError, getStaffAccess } from '@/lib/api';
import { createMaintenanceGateway } from '@/lib/maintenance/api';
import type { MaintenanceGateway, MaintenanceTask } from '@/lib/maintenance/types';

type Context = {
  tasks: MaintenanceTask[]; loading: boolean; error: string; gateway: MaintenanceGateway;
  displayName: string; refresh: () => Promise<void>; onSignOut: () => Promise<void>;
};
const Store = createContext<Context | null>(null);

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.ready && auth.role === 'maintenance' ? auth.user?.user_id : undefined;
  return <MaintenanceSession key={userId ?? 'signed-out'} userId={userId} signOut={auth.signOut}>{children}</MaintenanceSession>;
}

function MaintenanceSession({ children, userId, signOut }: { children: ReactNode; userId?: string; signOut: () => void }) {
  const remote = useMemo(() => createMaintenanceGateway(), []);
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [loading, setLoading] = useState(!!userId);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('Maintenance staff');
  const active = useRef(false);
  const sequence = useRef(0);
  const working = useRef(false);
  const fetchTasks = useCallback(async () => {
    if (!userId || working.current) return;
    const request = ++sequence.current;
    try {
      const [items, profile] = await Promise.all([remote.listTasks(), getStaffAccess()]);
      if (profile.user_id !== userId || profile.role !== 'maintenance') throw new ApiError('Your staff session changed. Sign in again.', 403);
      if (active.current && request === sequence.current) { setTasks(items); setDisplayName(profile.display_name); setError(''); }
    } catch (reason) {
      if (active.current && request === sequence.current) {
        setTasks([]); setError(reason instanceof Error ? reason.message : 'Unable to load tasks.');
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) signOut();
      }
    } finally {
      if (active.current && request === sequence.current) setLoading(false);
    }
  }, [remote, userId, signOut]);
  const refresh = useCallback(async () => {
    if (working.current) return;
    setLoading(true); setError('');
    await fetchTasks();
  }, [fetchTasks]);
  useEffect(() => {
    active.current = true;
    const request = ++sequence.current;
    if (userId) Promise.all([remote.listTasks(), getStaffAccess()]).then(([items, profile]) => {
      if (profile.user_id !== userId || profile.role !== 'maintenance') throw new ApiError('Your staff session changed. Sign in again.', 403);
      if (active.current && request === sequence.current) { setTasks(items); setDisplayName(profile.display_name); setError(''); }
    }).catch(reason => {
      if (active.current && request === sequence.current) {
        setTasks([]); setError(reason instanceof Error ? reason.message : 'Unable to load tasks.');
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) signOut();
      }
    }).finally(() => { if (active.current && request === sequence.current) setLoading(false); });
    // Background refresh must not unmount the upload input when a file picker closes.
    window.addEventListener('focus', fetchTasks);
    return () => { active.current = false; window.removeEventListener('focus', fetchTasks); };
  }, [remote, userId, signOut, fetchTasks]);

  async function apply(operation: () => Promise<MaintenanceTask>) {
    if (working.current) throw new ApiError('Wait for the current update to finish.', 409);
    working.current = true;
    sequence.current++;
    setLoading(false);
    try {
      const task = await operation();
      if (active.current) setTasks(items => [...items.filter(item => item.id !== task.id), task]);
      return task;
    } catch (reason) {
      working.current = false;
      if (reason instanceof ApiError && [404, 409].includes(reason.status)) await refresh();
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) signOut();
      throw reason;
    } finally { working.current = false; }
  }
  const gateway: MaintenanceGateway = {
    listTasks: remote.listTasks,
    getTask: id => apply(() => remote.getTask(id)),
    startWork: id => apply(() => remote.startWork(id)),
    saveUpdate: (id, notes) => apply(() => remote.saveUpdate(id, notes)),
    reportBlocker: (id, type, details) => apply(() => remote.reportBlocker(id, type, details)),
    submitEvidence: (id, input) => apply(() => remote.submitEvidence(id, input)),
  };
  return <Store.Provider value={{ tasks, loading, error, gateway, displayName, refresh, onSignOut: async () => signOut() }}>{children}</Store.Provider>;
}

export function useMaintenance() {
  const value = useContext(Store);
  if (!value) throw new Error('MaintenanceProvider is required');
  return value;
}
