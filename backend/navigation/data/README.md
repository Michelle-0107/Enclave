# KL East pilot road snapshot

Data attribution: OpenStreetMap contributors.
License: Open Database License (ODbL) 1.0.
Copyright and license information: https://www.openstreetmap.org/copyright
License text: https://opendatacommons.org/licenses/odbl/1-0/

`kl-east.osm.pbf` is a small public OpenStreetMap extract for local routing tests.
`source.json` records the source URL, retrieval timestamp, bounding box, dataset
counts, and SHA-256 checksum. The XML map response was converted to PBF with
Pyosmium 4.3.1; node/way/relation IDs, geometry, tags, and data metadata are retained.
No Supabase records, resident data, private GPS traces, or provider keys are included.

This is a development window around KL East Mall/Park, not an official township
boundary. Nearby mapped roads may be included. Presence in this dataset does not
prove public access, current opening conditions, completeness, or field verification.
No road rows are seeded into Supabase automatically. Keep the snapshot attribution
when redistributing it and show appropriate attribution in the map application.

## Resident road access policy

Live and resident-demo routing share the server-side `walking_graph` for every
enabled service area. The app treats every active verified resident as a resident
of all enabled residential service areas; no per-township membership lookup is
performed. Routes may therefore include otherwise walkable outdoor ways tagged
`access=private` or `foot=private`, including private residential gates that are
not marked locked. The original OSM tags and source checksums remain unchanged.

This policy does not override explicit `foot=no`, `access=no`, locked gates,
walls, fences, motorroads, high-speed road exclusions, or indoor restrictions.
Opposite road sides still require a mapped pedestrian crossing, footbridge, or
underpass. Private access does not confer verified wheelchair accessibility.
Resident route endpoints continue to require an active verified account; the
private-access option is not a caller-controlled request field. Route warnings
identify use of private ways under this app policy.
