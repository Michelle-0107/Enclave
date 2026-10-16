# KL East navigation status

Implemented: explicit facility/incident linking, two-distinct-resident map threshold,
maintenance-independent damage avoidance, distance-based walking, and strict routing
on assessed accessible graphs. Real accessible coverage is currently empty; accessible
requests return no verified route rather than falling back to ordinary walking.

See [COMMUNITY_ROUTES_TESTING.md](COMMUNITY_ROUTES_TESTING.md) for the current complete
contract and limitations. SQL 009 supersedes SQL 008 route restrictions; SQL 007
maintenance remains in place, with verified repair closing the linked incident.

Still required: frontend point selection and link calls, MapLibre layers, three mode
buttons, GPS/progress/voice/recompute, surveyed accessible paths/approaches, device
tests, manual hosted SQL 009, and deployment of the separate private routing engine.
No application env names or teammate routers/services/frontend were changed.
