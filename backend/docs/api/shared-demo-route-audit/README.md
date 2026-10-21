# Shared demo facility routing audit

Run from the repository root:

```powershell
.venv\Scripts\python.exe -B -m backend.tools.audit_shared_demo_routes
```

Both original walking-eligible batches remain frozen, with 240 cases each:
two areas, four categories, primary and holdout, 30 cases per group. Their
LF-normalized SHA-256 hashes are checked before running. No endpoint adjustment
or replacement sample is allowed. Every unavailable route and its reason is
retained in the compressed case reports, alongside the complete successful
geometry, maneuvers, facility IDs and provenance.

The audit calls the resident app's `calculate_demo_routes` entry point with the
walking profile, which calculates all three options. It checks:

- Ordinary walking availability at least 95% in every group (29 of 30).
- Step-free availability at least 80% in every group (24 of 30).
- Whenever step-free exists, shortest and avoid-damage also exist and are no
  longer than step-free. This checks actual route responses, not display labels.
- Maneuver totals match distance within 1 mm. Geometry distance agrees within
  10 cm, allowing the router's omission of degenerate edges shorter than 1 cm.
- Accessibility provenance and the requested endpoints are preserved.

Results: **477/480 ordinary walking (99.38%)**, **470/480 step-free (97.92%)**,
and **zero distance-order failures**. The lowest ordinary group is 29/30;
the lowest step-free group is 26/30. All 16 groups pass their respective gates.
These are synthetic network checks, not field verification or live availability.

Ordinary walking now includes the same registered hypothetical ramps, crossings,
lift-access bridges and entrances used by step-free, while retaining stairs.
Unregistered open-land connections remain fallback-only and at most 20 m.
Only complete, valid step-free paths on those shared facilities may enter the
ordinary candidate pool, with target-mode damage restrictions checked again.
The separate step-free view continues to exclude stairs and unmarked crossings.

No frozen samples, facility placement rules, original audit results, Live graph,
OSM topology cache or field-verification flags were changed. Production requires
the updated backend deployment. UI alignment and continuous restriction shading
also require the updated mobile bundle and management web respectively.


The gate counts shortest-route availability on endpoints prequalified for
walking access. Avoid-damage options are retained but their availability is not
the 95% gate. This is not a guarantee for arbitrary map taps, all named places,
or What-if plans with the current database restriction snapshot. What-if's
verified accessible mode is also distinct from this hypothetical step-free
network. See `../what-if-endpoint-audit/README.md` for the separate reference and
catalog access check, including retained inaccessible endpoints.

Ordinary building access now retains its nearest usable road association when
a registered simulated step-free entrance is unreachable from the selected
part of the building. This changes no outdoor 20 m limit, crossing/barrier
checks or step-free acceptance rules. All original 480 cases were rerun after
that correction; none were replaced.
