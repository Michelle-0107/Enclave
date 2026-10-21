# Resident map and road restriction corrections

Jalan 3/5A exposed a general classification defect: SQL 022 created every named
place as `other`, including OSM road references. Those reports did not affect
routes. In addition, 100m reporting sections previously used only a 5m midpoint
zone instead of their canonical segment geometry.

## Routing and database rollout

Apply `backend/sql/024_road_reference_routing.sql` after 023, and deploy the updated
backend. The migration is rerunnable and is under 100 KB for the SQL Editor.
It enriches all supported named road references identified by OSM way UUIDs and fixes existing
matching `other` facilities to `path_surface`. It leaves mall/station/building
places alone and does not change report IDs, coordinates, categories, history,
reporter counts or maintenance tasks.

`python -m backend.tools.build_road_binding_migration` reproduces this SQL offline.
No road display name is hardcoded into the classifier. The shared registry remains
the client source; the backend verifies bindings against the same canonical OSM
extracts and section IDs that seeded it. Relocated identities do not inherit a
binding. A legacy whole-road incident uses the closest canonical section of its
own OSM way; it never binds an adjacent unrelated road. A reference centroid can
lie off its road polyline. This binding creates no access connector and does not
change the existing 20m outdoor access rule. Existing legacy evidence is not silently redistributed.

New reports must select the independent road section at the actual issue pin.
Whole-road references are removed from the facility choices and rejected by the
link API/SQL; named buildings and stations remain reportable. The 2072 existing
section IDs and independent reporter counts are preserved.

Resident community obstacle snapshots and What-if now use the same complete
bound section geometry with the existing 5m local exclusion width. Point-only
facilities keep their existing zones. Unknown/non-road facilities are not
arbitrarily attached to nearby roads. A stale road classification blocks the
comparison with 409 until the catalog update, rather than returning misleading
equal before/after values. Route candidates crossing remaining restrictions are
rejected; a genuinely unaffected alternate route may still remain unchanged.

## Map and input behavior

The resident map legend follows the facility-marker toggle. Both location search
lists show three results initially. Map-selected endpoint names appear in the
editable inputs and endpoint cards; report selections appear in the search input,
with no second address label. Delayed reverse lookups cannot replace edited text.

Both management facility maps use GeoJSON circle/symbol layers rather than DOM
markers, sharing the basemap camera transform while panning and zooming. Facility
popup and selected-repair controls remain available. Journey endpoints remain
draggable DOM markers where appropriate.

## Validation

Coverage includes all 2072 section geometries, all 205 supported road-reference identities, six
independent real residential-road before/after comparisons, wrong/relocated IDs,
stale classification, SQL reruns and inherited shared report workflow tests.
UI regressions cover folding, in-input place names, stale requests, legend
visibility, fixed facility coordinates, popups and cleanup. Existing What-if,
community, report and app type/lint checks are also run.

Production was inspected read-only to identify the original road classification.
The migration is prepared locally; it has not been applied to production by this
task. The exact screenshot journey cannot be reconstructed from distances alone;
the road-engine regression uses explicit, recorded endpoints on the same road.
