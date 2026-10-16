/**
 * Enclave backend API client.
 *
 * Matches the routes shown in the backend main application.
 * Registration and login endpoints will be added after
 * the backend registration router is provided.
 */

export type CurrentUser = {
  user_id: string;
  email: string | null;
};

/**
 * Full report fields need confirmation from reports/models.py.
 * Keep unknown fields explicit until those models are supplied.
 */
export type ReportRecord = Record<string, unknown>;

export type ReportListResponse = {
  items: ReportRecord[];
  limit: number;
  offset: number;
};

export type ReportCreatedResponse = {
  ticket_id: string;
  ai_analysis: Record<string, unknown>;
  image_url: string;
  data: ReportRecord[];
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);

    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  accessToken?: string;
  body?: FormData | Record<string, unknown>;
  headers?: Record<string, string>;
};

function getBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (!url) {
    throw new ApiError(
      'Backend URL is not configured.',
      0,
    );
  }

  return url.replace(/\/+$/, '');
}

function getErrorMessage(
  data: unknown,
  status: number,
): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = data.detail;

    if (typeof detail === 'string') {
      return detail;
    }

    // FastAPI validation errors.
    if (Array.isArray(detail)) {
      const messages = detail.map((item: unknown) => {
        if (
          item &&
          typeof item === 'object' &&
          'msg' in item &&
          typeof item.msg === 'string'
        ) {
          return item.msg;
        }

        return 'Invalid request field';
      });

      return messages.join('. ');
    }
  }

  return `Request failed (${status}).`;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const baseUrl = getBaseUrl();
  const controller = new AbortController();

  // Photo upload and AI processing may take longer.
  const timeout = setTimeout(
    () => controller.abort(),
    60000,
  );

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    if (options.accessToken) {
      headers.Authorization =
        `Bearer ${options.accessToken}`;
    }

    const body = options.body instanceof FormData
      ? options.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);

    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(
          `The server returned an invalid response (${response.status}).`,
          response.status,
        );
      }
    }

    if (!response.ok) {
      throw new ApiError(
        getErrorMessage(data, response.status),
        response.status,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new ApiError(
        'The request timed out. Check My Reports before submitting again.',
        0,
      );
    }

    throw new ApiError(
      'Unable to connect to the backend.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const healthApi = {
  check(): Promise<{ status: string }> {
    return request<{ status: string }>('/health');
  },
};

export const authApi = {
  /**
   * Requires a real Supabase Auth access_token.
   * This checks an existing session; it does not sign in.
   */
  getCurrentUser(
    accessToken: string,
  ): Promise<CurrentUser> {
    return request<CurrentUser>('/auth/me', {
      accessToken,
    });
  },
};

export const reportsApi = {
  /**
   * Required FormData fields:
   * - description: string, 1–1000 characters
   * - latitude: string representation of a number
   * - longitude: string representation of a number
   * - file: JPEG or PNG, maximum 10 MiB
   *
   * Do not send user_id.
   * Backend identifies the owner from the access token.
   */
  submit(
    accessToken: string,
    form: FormData,
  ): Promise<ReportCreatedResponse> {
    return request<ReportCreatedResponse>(
      '/api/v1/reports',
      {
        method: 'POST',
        accessToken,
        body: form,
      },
    );
  },

  getMyReports(
    accessToken: string,
    limit = 10,
    offset = 0,
  ): Promise<ReportListResponse> {
    const query =
      `limit=${encodeURIComponent(String(limit))}` +
      `&offset=${encodeURIComponent(String(offset))}`;

    return request<ReportListResponse>(
      `/api/v1/reports?${query}`,
      { accessToken },
    );
  },

  getReport(
    accessToken: string,
    ticketId: string,
  ): Promise<ReportRecord> {
    return request<ReportRecord>(
      `/api/v1/reports/${encodeURIComponent(ticketId)}`,
      { accessToken },
    );
  },
};

export type RequestOtpPayload = {
  email: string;
};

export type OtpAcceptedResponse = {
  challenge_id: string;
  message: string;
};

export type VerifySignupPayload = {
  challenge_id: string;
  otp: string;
  password: string;
};

export type AuthSessionData = {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
};

export type SignupResultResponse = {
  status: 'registered';
  resident_id: string;
  user_id: string;
  session: AuthSessionData;
};

export const registrationApi = {
  requestOtp(payload: RequestOtpPayload): Promise<OtpAcceptedResponse> {
    return request<OtpAcceptedResponse>('/api/v1/registration/request-otp', {
      method: 'POST',
      body: payload,
    });
  },

  verifyAndSignup(
    payload: VerifySignupPayload,
    idempotencyKey: string,
  ): Promise<SignupResultResponse> {
    return request<SignupResultResponse>('/api/v1/registration/verify-and-signup', {
      method: 'POST',
      body: payload,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
};
