# What-if reference and catalog access coverage

The original 480-case gate covers walking-eligible endpoints. Each endpoint was
checked for walking access when the samples were frozen; component connectivity
and route success were not eligibility filters. Its shortest-route percentage
does not measure arbitrary map taps, named-place coverage, current database
damage, or verified accessible routes in What-if. The simulated step-free audit
also does not certify What-if's separate surveyed accessibility network.

This independent check keeps every KL East case from both frozen batches (240),
calls the production What-if `SimulationNavigation` adapter with no damage, then
repeats with its fixed comparison endpoints and verifies drift stays within 1 m.
It also checks every catalog point inside the What-if pilot window (898), without
filtering on access success. This second result is individual endpoint access,
not the success percentage of origin/destination route pairs. Current reported
restrictions are deliberately absent to isolate the failed healthy-reference
condition shown in the UI; this is not a production Before/After availability
measurement.

| Measurement | Before correction | After correction |
|---|---:|---:|
| Frozen KL East damage-free What-if references | 236/240 (98.33%) | 237/240 (98.75%) |
| Catalog endpoints with ordinary walking access | 840/898 (93.54%) | 842/898 (93.76%) |
| Catalog building endpoints without access | 6 | 4 |
| Catalog outdoor endpoints without access | 52 | 52 |

The correction fixes ordinary walkers incorrectly being required to use an
unreachable registered step-free building entrance. They now retain their
existing nearest usable road association when that ramp is unreachable. The
same point still fails step-free validation. Decathlon and Residensi Rabung KL
Timur Tower B reproduce the defect; the change has no place-name or coordinate
special cases. A synthetic building with an intervening wall verifies the same
behavior, and an API comparison from Decathlon to Jaya Grocer verifies complete
Before/After geometry around the remaining database-fixture restrictions.

The remaining failures are retained. Outdoor approaches still have the 20 m
limit; walls, water and prohibited road crossings remain barriers. Registering
virtual facilities does not give every selected endpoint access to them. A
healthy-reference endpoint failure is shared by every repair plan using that
journey, so trying additional plans does not represent independent endpoint
samples. The screenshot coordinates were not available; these checks do not
claim to reproduce that exact pin pair.

`before.json.gz` and `after.json.gz` retain all 240 reference cases and all 898
catalog access results, including every failure. Resident-option flags inside
these files refer to the previously archived app audit used for comparison.
They are not newly calculated production availability.

Reproduce the current adapter and catalog check from the repository root:

```powershell
.venv\Scripts\python.exe -B -m backend.tools.audit_what_if_access
```

This writes `current.json` beside this report and preserves both saved reports.
Frozen sample hashes are checked before calculation. The new output records the
sample, catalog and algorithm hashes. The original 480-case app gate can be run
separately with `python -m backend.tools.audit_shared_demo_routes`; that tool
continues to retain the full geometries and all failures in its existing folder.
