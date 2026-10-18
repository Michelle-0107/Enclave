import { uploadMultipart } from './multipartUpload';

/**
 * Enclave mobile backend API client.
 *
 * Community map:
 * - A marker represents a facility issue, not a private report.
 * - Map visibility is determined by the backend.
 * - At least two distinct verified residents must report
 *   the same open issue before it appears on the map.
 *
 * Private reports retain their original ticket fields
 * and maintenance workflow.
 */

export type CurrentUser = {
  user_id: string;
  email: string | null;
};

export type ResidencyRecord = {
  resident_id: string;
  full_name: string | null;
  unit_number: string;
  status: 'active' | 'inactive';
  verified_at: string | null;
};

// Private report types: keep these separate from map issue types.
export type ReportRecord = {
  ticket_id: string;
  user_id: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'in_progress' | 'resolved' | string;
  created_at: string | null;
  latitude: number;
  longitude: number;
  image_url: string | null;
  category: string | null;
  priority: string | null;
  is_approved: boolean;
};

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

export type ReportHistoryEvent = {
  id: number;
  from_status: string;
  to_status: string;
  note: string;
  repair_verified: boolean;
  created_at: string;
  actor_role: 'management';
};

export type ReportHistoryResponse = {
  ticket_id: string;
  items: ReportHistoryEvent[];
  limit: number;
  offset: number;
  has_more: boolean;
};

// Community map and facility types.
export type FacilityType =
  | 'path_surface'
  | 'ramp'
  | 'stairs'
  | 'kerb'
  | 'crossing'
  | 'elevator'
  | 'streetlight'
  | 'drainage'
  | 'bench'
  | 'other';

export type FaultKind = 'damage' | 'obstruction';

export type Pagination = {
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
};

export type AreaQuery = {
  limit?: number;
  offset?: number;

  // [west, south, east, north]
  bbox?: [number, number, number, number];
};

export type MapIssueFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Point';

    // GeoJSON uses [longitude, latitude].
    coordinates: [number, number];
  };
  properties: {
    issue_id: string;
    facility_id: string;
    facility_name: string;
    facility_type: FacilityType;
    fault_kind: FaultKind;
    reporter_count: number;
    confirmation_threshold: 2;
    status: 'open' | 'resolved';
    affects_routes: boolean;
    reported_at: string | null;
    resolved_at: string | null;
    verification: 'community_reported';
  };
};

export type CommunityMapResponse = {
  type: 'FeatureCollection';
  features: MapIssueFeature[];
  pagination: Pagination;
};

export type NavigationArea = {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  center: [number, number];
  map_style_url: string;
  attribution_url: string;
  supported_route_modes: Array<'shortest' | 'avoid_damage' | 'accessible'>;
  accessible_network_available: boolean;
  verified_accessible_segments: number;
  field_verified: false;
  official_boundary: false;
  temporary_live?: boolean;
  community_issues_supported?: boolean;
  crossing_policy?: 'provider_default' | 'mapped_facilities_only' | 'resident_local_roads';
};

export type FacilityRecord = {
  id: string;
  name: string;
  facility_type: FacilityType;
  latitude: number;
  longitude: number;
  created_at: string;
};

export type FacilityListResponse = {
  items: FacilityRecord[];
  pagination: Pagination;
};

export type CommunityIssueRecord = {
  id: string;
  facility_id: string;
  facility_name: string;
  facility_type: FacilityType;
  latitude: number;
  longitude: number;
  fault_kind: FaultKind;
  status: 'open' | 'resolved';
  reporter_count: number;
  affects_routes: boolean;
  created_at: string;
  resolved_at: string | null;
};

export type CommunityIssueListResponse = {
  items: CommunityIssueRecord[];
  pagination: Pagination;
};

export type IssueLinkResponse = {
  issue: CommunityIssueRecord;
  deduplicated: boolean;
  community_visible: boolean;
};

export type NotificationRecord = {
  id: number;
  title: string;
  message: string;
  related_report_id: number | null;
  is_read: boolean;
  created_at: string;
  published_at: string | null;
  expires_at: string | null;
};

export type NotificationListResponse = {
  items: NotificationRecord[];
  limit: number;
  offset: number;
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

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);

    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = {
  timeoutMs?: number;
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

function makeAreaQuery(options: AreaQuery = {}): string {
  const params = [
    `limit=${encodeURIComponent(String(options.limit ?? 100))}`,
    `offset=${encodeURIComponent(String(options.offset ?? 0))}`,
  ];

  if (options.bbox) {
    params.push(
      `bbox=${encodeURIComponent(options.bbox.join(','))}`,
    );
  }

  return params.join('&');
}

function getErrorMessage(
  data: unknown,
  status: number,
): string {
  if (
    data &&
    typeof data === 'object' &&
    'detail' in data
  ) {
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
    options.timeoutMs ?? 60000,
  );

  const isFormData = options.body instanceof FormData;

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    if (options.accessToken) {
      headers.Authorization =
        `Bearer ${options.accessToken}`;
    }

    const body = isFormData
      ? options.body as FormData
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);

    if (
      options.body !== undefined &&
      !isFormData
    ) {
      headers['Content-Type'] = 'application/json';
    }

    const response = isFormData
      ? await uploadMultipart(`${baseUrl}${path}`, {
          method: options.method ?? 'POST', headers,
          body: options.body as FormData, signal: controller.signal,
        })
      : await fetch(`${baseUrl}${path}`, {
          method: options.method ?? 'GET', headers, body,
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
        isFormData
          ? 'The request timed out. Check My Reports before submitting again.'
          : 'The request timed out. Please check your connection and try again.',
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
   * Checks an existing Supabase Auth session.
   * This endpoint does not sign in.
   */
  getCurrentUser(
    accessToken: string,
  ): Promise<CurrentUser> {
    return request<CurrentUser>(
      '/auth/me',
      { accessToken },
    );
  },
};

export const residencyApi = {
  getMyResidency(
    accessToken: string,
  ): Promise<ResidencyRecord> {
    return request<ResidencyRecord>(
      '/api/v1/me/residency',
      { accessToken },
    );
  },
};

export const reportsApi = {
  /**
   * Required FormData fields:
   * - description
   * - latitude
   * - longitude
   * - file: JPEG or PNG, maximum 10 MiB
   *
   * Backend identifies the owner from the access token.
   * Do not send user_id.
   *
   * To contribute to a community issue, link the returned
   * ticket_id using communityIssuesApi after upload succeeds.
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

  /**
   * Confirmed community map layer.
   * Backend applies the visibility threshold.
   *
   * Preserves the existing method name for current callers.
   * Use pagination.has_more to request additional pages.
   */
  getCommunityIssues(
    accessToken: string,
    limit = 100,
    offset = 0,
    bbox?: [number, number, number, number],
    includeResolved = false,
  ): Promise<CommunityMapResponse> {
    const query = makeAreaQuery({
      limit,
      offset,
      bbox,
    });

    return request<CommunityMapResponse>(
      `/api/v1/map/issues?${query}` +
        `&include_resolved=${includeResolved}`,
      { accessToken },
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

  getReportHistory(
    accessToken: string,
    ticketId: string,
  ): Promise<ReportHistoryResponse> {
    return request<ReportHistoryResponse>(
      `/api/v1/reports/${encodeURIComponent(ticketId)}` +
        '/history?limit=50',
      { accessToken },
    );
  },
};

export const facilitiesApi = {
  getAll(
    accessToken: string,
    options: AreaQuery = {},
  ): Promise<FacilityListResponse> {
    return request<FacilityListResponse>(
      `/api/v1/facilities?${makeAreaQuery(options)}`,
      { accessToken },
    );
  },

  /**
   * Create only when there is no matching existing facility.
   * Coordinates must be inside the backend's KL East pilot.
   */
  create(
    accessToken: string,
    payload: {
      name: string;
      facility_type: FacilityType;
      latitude: number;
      longitude: number;
    },
  ): Promise<FacilityRecord> {
    return request<FacilityRecord>(
      '/api/v1/facilities',
      {
        method: 'POST',
        accessToken,
        body: payload,
      },
    );
  },
};

export const communityIssuesApi = {
  /**
   * Issue selection list.
   *
   * Can include open issues with only one reporter.
   * Do not use this list as the confirmed map layer.
   */
  getAll(
    accessToken: string,
    options: AreaQuery = {},
  ): Promise<CommunityIssueListResponse> {
    return request<CommunityIssueListResponse>(
      `/api/v1/community/issues?${makeAreaQuery(options)}`,
      { accessToken },
    );
  },

  /**
   * Create an issue or reuse the existing open issue
   * for the same facility and fault kind.
   *
   * Upload the private report first and supply its ticket_id.
   */
  createOrLink(
    accessToken: string,
    payload: {
      facility_id: string;
      fault_kind: FaultKind;
      report_ticket_id: string;
    },
  ): Promise<IssueLinkResponse> {
    return request<IssueLinkResponse>(
      '/api/v1/community/issues',
      {
        method: 'POST',
        accessToken,
        body: payload,
      },
    );
  },

  /**
   * Link the current resident's uploaded report
   * to an existing issue.
   *
   * If linking fails, retain the ticket and retry linking.
   * Do not automatically upload another report.
   */
  linkReport(
    accessToken: string,
    issueId: string,
    reportTicketId: string,
  ): Promise<IssueLinkResponse> {
    return request<IssueLinkResponse>(
      `/api/v1/community/issues/${encodeURIComponent(issueId)}/reports`,
      {
        method: 'POST',
        accessToken,
        body: {
          report_ticket_id: reportTicketId,
        },
      },
    );
  },
};

export const notificationsApi = {
  getAll(
    accessToken: string,
    limit = 50,
    offset = 0,
  ): Promise<NotificationListResponse> {
    const query =
      `limit=${encodeURIComponent(String(limit))}` +
      `&offset=${encodeURIComponent(String(offset))}`;

    return request<NotificationListResponse>(
      `/api/v1/notifications?${query}`,
      { accessToken },
    );
  },

  markRead(
    accessToken: string,
    notificationId: number,
  ): Promise<void> {
    return request<void>(
      `/api/v1/notifications/${notificationId}/read`,
      {
        method: 'POST',
        accessToken,
      },
    );
  },
};

export const registrationApi = {
  requestOtp(
    payload: RequestOtpPayload,
  ): Promise<OtpAcceptedResponse> {
    return request<OtpAcceptedResponse>(
      '/api/v1/registration/request-otp',
      {
        method: 'POST',
        body: payload,
      },
    );
  },

  verifyAndSignup(
    payload: VerifySignupPayload,
    idempotencyKey: string,
  ): Promise<SignupResultResponse> {
    return request<SignupResultResponse>(
      '/api/v1/registration/verify-and-signup',
      {
        method: 'POST',
        body: payload,
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
  },
};

export type RouteMode =
  | 'shortest'
  | 'avoid_damage'
  | 'accessible';

export type NavigationPoint = {
  latitude: number;
  longitude: number;
};

export type NavigationRequest = {
  origin: NavigationPoint;
  destination: NavigationPoint;
  profile: 'walking';
  language: 'en';
  route_mode: RouteMode;
};

export type NavigationManeuver = {
  type?: number;
  begin_shape_index?: number;
  end_shape_index?: number;
  instruction: string;
  spoken_instruction: string;
  coordinate: [number, number];
  distance_from_start_meters: number;
};

export type NavigationRouteResponse = {
  route_id: string;
  generated_at: string;
  area: string;
  routing_engine: 'valhalla' | 'verified_network' | 'osm_roadside';
  road_fallback_used?: boolean;
  crossing_policy?: 'provider_default' | 'mapped_facilities_only' | 'resident_local_roads';
  mapped_crossing_count?: number;
  unmarked_crossing_count?: number;
  route_mode: RouteMode;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distance_meters: number;
  duration_seconds: number;
  origin_snap_distance_meters: number;
  destination_snap_distance_meters: number;
  maneuvers: NavigationManeuver[];
  community_issue_avoidance:
    | 'not_applied'
    | 'applied'
    | 'no_active_obstacles';
  obstacle_count: number;
  obstacle_snapshot_at: string | null;
  obstacle_source: 'community_reports' | null;
  demo_facility_ids?: string[];
  confirmation_threshold: 2;
  data_source: 'openstreetmap_unverified' | 'synthetic_demo' | 'verified_accessibility_network';
  field_verified: boolean;
  accessibility_status: 'not_requested' | 'verified_network' | 'synthetic_network';
  warnings: string[];
  attribution: string;
  attribution_url: string;
};

export const navigationApi = {
  getArea(accessToken: string, areaId?: string): Promise<NavigationArea> {
    const query = areaId ? `?area_id=${encodeURIComponent(areaId)}` : '';
    return request<NavigationArea>(`/api/v1/navigation/area${query}`, { accessToken });
  },

  getRoute(
    accessToken: string,
    payload: NavigationRequest,
  ): Promise<NavigationRouteResponse> {
    return request<NavigationRouteResponse>(
      '/api/v1/navigation/routes',
      {
        method: 'POST',
        accessToken,
        body: payload,
      },
    );
  },
};


export type ResidentServiceArea = {
  id: string; name: string; bbox: [number, number, number, number]; center: [number, number];
  enabled: boolean; routing_supported: boolean; resident_demo_supported: boolean;
};

export type DemoRouteRequest = {
  origin: NavigationPoint;
  destination: NavigationPoint;
  profile: 'walking' | 'wheelchair';
  start_candidates: NavigationPoint[];
};

export type DemoRouteOption = {
  mode: RouteMode;
  route: NavigationRouteResponse | null;
  unavailable_reason: string | null;
};

export type DemoRouteResponse = {
  area_id: string;
  requested_origin: NavigationPoint;
  selected_origin: NavigationPoint;
  start_adjustment_meters: number;
  adjusted_start: boolean;
  options: DemoRouteOption[];
};

export const demoAreasApi = {
  getAll(accessToken: string): Promise<{ default_area_id: string; items: ResidentServiceArea[] }> {
    return request('/api/v1/navigation/areas', { accessToken, timeoutMs: 15000 });
  },
  getDataset(accessToken: string, areaId: string): Promise<{ area_id: string; dataset: unknown }> {
    return request(`/api/v1/navigation/areas/${encodeURIComponent(areaId)}/demo`, { accessToken, timeoutMs: 15000 });
  },
  getRoutes(accessToken: string, areaId: string, payload: DemoRouteRequest): Promise<DemoRouteResponse> {
    return request(`/api/v1/navigation/areas/${encodeURIComponent(areaId)}/demo-routes`, {
      method: 'POST', accessToken, body: payload, timeoutMs: 30000,
    });
  },
};
