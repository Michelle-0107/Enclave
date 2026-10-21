import type { CommunityIssueRecord, MapIssueFeature } from './api';

export type DisplayMapIssue = {
  id: string;
  coordinates: [number, number];
  facilityName: string;
  facilityType: CommunityIssueRecord['facility_type'];
  faultKind: CommunityIssueRecord['fault_kind'];
  reporterCount: number;
  confirmed: boolean;
};

// The confirmed endpoint controls route-impacting map markers. The discovery
// endpoint supplies only open issues still waiting for a second resident.
export function mapIssueLayers(
  confirmed: MapIssueFeature[],
  discovered: CommunityIssueRecord[],
): DisplayMapIssue[] {
  const markers = new Map<string, DisplayMapIssue>();
  for (const issue of confirmed) {
    markers.set(issue.id, {
      id: issue.id,
      coordinates: issue.geometry.coordinates,
      facilityName: issue.properties.facility_name,
      facilityType: issue.properties.facility_type,
      faultKind: issue.properties.fault_kind,
      reporterCount: issue.properties.reporter_count,
      confirmed: true,
    });
  }
  for (const issue of discovered) {
    if (issue.status !== 'open' || issue.reporter_count >= 2 || markers.has(issue.id)) continue;
    markers.set(issue.id, {
      id: issue.id,
      coordinates: [issue.longitude, issue.latitude],
      facilityName: issue.facility_name,
      facilityType: issue.facility_type,
      faultKind: issue.fault_kind,
      reporterCount: issue.reporter_count,
      confirmed: false,
    });
  }
  return Array.from(markers.values());
}
