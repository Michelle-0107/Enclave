const SESSION_KEY = 'enclave-web-auth-session-v1';

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_at: number;
};

type SupabaseSessionResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error_description?: string;
  msg?: string;
  message?: string;
};

let refreshInFlight: Promise<AuthSession | null> | null = null;

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the web environment.',
    );
  }

  return { url, key };
}

function toSession(payload: SupabaseSessionResponse): AuthSession {
  if (
    !payload.access_token ||
    !payload.refresh_token ||
    !payload.expires_in
  ) {
    throw new Error('Supabase did not return a complete login session.');
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: 'bearer',
    expires_at: Date.now() + payload.expires_in * 1000,
  };
}

async function responseError(response: Response) {
  let payload: SupabaseSessionResponse = {};

  try {
    payload = (await response.json()) as SupabaseSessionResponse;
  } catch {
    // Providers may return an empty body for some failures.
  }

  return (
    payload.error_description ??
    payload.msg ??
    payload.message ??
    `Supabase authentication failed (${response.status}).`
  );
}

export function readAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const value = window.sessionStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const session = JSON.parse(value) as AuthSession;

    if (
      typeof session.access_token !== 'string' ||
      typeof session.refresh_token !== 'string' ||
      typeof session.expires_at !== 'number'
    ) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function writeAuthSession(session: AuthSession) {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

export function clearAuthSession() {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function signInWithPassword(email: string, password: string) {
  const { url, key } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  const session = toSession(
    (await response.json()) as SupabaseSessionResponse,
  );
  writeAuthSession(session);
  return session;
}

async function refreshAuthSession(
  session: AuthSession,
): Promise<AuthSession | null> {
  const { url, key } = getSupabaseConfig();
  const response = await fetch(
    `${url}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    clearAuthSession();
    return null;
  }

  const nextSession = toSession(
    (await response.json()) as SupabaseSessionResponse,
  );
  writeAuthSession(nextSession);
  return nextSession;
}

export async function getValidAccessToken() {
  const session = readAuthSession();
  if (!session) return null;
  if (session.expires_at > Date.now() + 60_000) {
    return session.access_token;
  }

  refreshInFlight ??= refreshAuthSession(session).finally(() => {
    refreshInFlight = null;
  });

  const refreshed = await refreshInFlight;
  return refreshed?.access_token ?? null;
}

/** Uses the existing Supabase session; no service-role key is used. */
export async function changeAccountPassword(email: string, current: string, next: string) {
  if (next.length < 8) throw new Error('Use at least 8 characters.');
  if (current === next) throw new Error('Choose a different password.');
  // Reauthenticate with the current password before attempting any update.
  const session = await signInWithPassword(email, current);
  const { url, key } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: next, current_password: current }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await responseError(response));
}
