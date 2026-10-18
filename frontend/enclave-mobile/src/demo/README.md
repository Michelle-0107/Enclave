# KL East resident demo

This resident-only screen follows the live map's visual layout and theme: blank
Starting point / End point fields, map selection and transport-specific route
options. There are no resident controls for simulated confirmations, repairs or
costs. Those belong in the future management web experience, which this change
does not implement.

## Area data

The previous fixed Mall-to-Park journey is removed. Version 3 includes **all
eligible mapped road/footway segments inside the backend pilot bbox**:
`[101.721, 3.217, 101.741, 3.235]` in longitude/latitude order. This is a pilot
rectangle, not an official township boundary. It contains 1,408 junctions,
1,600 compressed edges, 4,766 geometry vertices and 249 real named places.
Disconnected mapped components are retained, not artificially connected.

138 fictional facilities are spatially distributed across 48 populated cells
of an 8×8 area grid, including all four quadrants. They are selected independently
of any journey. Empty land without eligible mapped paths is not assigned an
invented road. Six fixture types cover crossings, ramps, stairs, pavement,
bridge walkways and step-free access. 35 initially have two simulated reports.
All counts and conditions are read-only for residents.

Roads and real landmarks come from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), downloaded 2026-10-15
from the source extract URL retained in dataset provenance. The derived road
and landmark data retains ODbL; fictional Enclave conditions are identified
separately. Every base edge retains its original OSM way/node IDs and every
curve vertex. Real building label positions never create entrance connectors.
OpenFreeMap supplies the real basemap with map attribution enabled.

## Resident interaction

### Travel profiles

| Profile | Resident choices | Routing source |
|---|---|---|
| Car | Open driving navigation | Google Maps with explicit driving mode |
| Walking | Shortest route; Avoid damaged facilities; Verified step-free route | Bundled mapped walking graph |
| Wheelchair | Verified step-free route only | Same graph with mandatory step-free and damage restrictions |

Walking is initially selected. Switching profiles retains the selected geographic
locations and clears the old route. Car pins use those original locations, without
pretending a pedestrian snap is a vehicle access point. Returning to Walking or
Wheelchair retains those pins for explicit access planning, including off-network selections. Wheelchair never falls back to an ordinary path.

"Verified step-free route" is the requested product option name. Its card and
profile description explicitly identify **simulated verification**, with no field
survey claim. The JSON and every computed route retain `fieldVerified: false`.
Driving is not computed by relabelling pedestrian paths. Only pressing Open driving
navigation launches an encoded [Google Maps directions URL](https://developers.google.com/maps/documentation/urls/get-started)
with the user-selected origin/destination and `travelmode=driving`. It contains no
API key, account token or fictional obstacle IDs. Google Maps handles real motor
vehicle routing; its directions do not incorporate this demo's fictional damage.
If the selected origin is remote from the phone's current location, Google Maps
can show route preview instead of turn navigation. If its app is unavailable, the
universal HTTPS link can open in the browser. No new dependency or env key is used.

- Initially no starting point, destination or route is selected.
- Tap the map for start/end, explicitly choose which field to replace, or search
  real mapped names. Coordinate entry uses `latitude, longitude`.
- Typing text invalidates the old selected coordinate and route. Only selecting
  a search result resolves a real location; arbitrary strings are not geocoded.
- Marker taps open read-only facility/place details and stop propagation, so they
  cannot silently replace an endpoint. Use as start/end is an explicit action.
- For Walking, Choose route calculates all three modes from the chosen coordinates. The
  screen lists the facilities and qualifying issues intersecting that path.
- Selecting a different mode draws that route and fits its geometry on the map.
- The Report button invokes the existing App callback. Demo IDs are never sent
  to the live reporting or maintenance database. Live community map stays separate.

## Geometry and routing

S / D begin at the original user-selected coordinates. Direct comparisons use the
nearest eligible mapped road/footway within the backend's 50 m limit; all modes share those anchors.
An off-network pin is retained rather than rejected at selection time.

For Walking, access planning searches mapped points within 100 m of the selected
start and keeps the selected destination anchor fixed. If a nearby point has a
connected path and fixes a disconnected or materially longer mapped route, Enclave
shows a consent dialog before changing the start. Accepting replaces S with the
connected mapped point and retains O as a reference; declining clears the start
so the resident can choose another. The app never silently moves a pin. Candidate
points are nearby positions on mapped ways, not surveyed entrances, and the
100 m threshold is a demo product setting.

After acceptance, tapping Go to adjusted starting point starts a separate approach
stage. Foreground GPS marks Me and S, then starts the destination route
when GPS reports both a position and accuracy within 20 m of S. A resident can
confirm arrival manually if GPS is unavailable or inaccurate. The O-to-S transfer
is not mapped or verified: distance and compass bearing are references only. The
screen tells the resident to use a visible public passage and not cross gates,
walls, water or private land. This transfer is excluded from route distance,
time and facility totals and is never certified step-free. The destination stays
fixed. Wheelchair does not use this ordinary-walking access fallback.
Vehicle one-way tags do not constrain pedestrians, even on a cycleway or footway;
explicit oneway:foot and directional foot restrictions do. Gates tagged access=no,
locked gates and foot=no remain excluded. Active verified residents are treated
as residents of enabled service areas; private local-road access and qualifying
unmarked crossings follow the shared backend resident policy.

The routing graph is split at the two selected positions and each facility's
3 m restriction radius along its source segment. This supports endpoints in the
middle of the same road and prevents a facility farther along that road from
being counted on a partial journey that never reaches it. Split geometry follows
the original polyline. Only shared OSM junction IDs connect different ways.
Mapped pedestrian direction is respected; a vehicle one-way restriction alone
does not prohibit walking in the opposite direction.

For server-provided service areas, routes are calculated by
`POST /api/v1/navigation/areas/{area_id}/demo-routes` on the same server-owned
roadside graph used by live walking. Backend maneuver text, geometry indexes,
and distances are retained for navigation. The on-device graph remains useful
for fixture tests and nearby-access suggestions; it is not the routing authority
for these service areas.

| Choice | Eligibility |
|---|---|
| Shortest | Ignore damage and use the minimum distance in the server graph |
| Avoid damaged facilities | Exclude confirmed fictional damage; stairs allowed |
| Verified step-free route | Also exclude mapped/simulated stairs and non-step-free assumptions; verification remains a demo assumption |

Identical routes are valid when no relevant restriction affects a journey.
Disconnected or off-network selections can offer the explicit nearby-access flow
above. There is no invented road, ordinary-route wheelchair fallback, or guarantee
that arbitrary places can physically be connected. No fixed route
distances or default destinations are stored in the app.

The real road map does not certify safe pedestrian access, crossing availability,
opening hours, slopes or wheelchair suitability. All facility/access conditions
remain labelled demo assumptions. Start Enclave guidance opens a dedicated full-screen
map, starts foreground GPS, displays the next turn or road-crossing instruction, updates remaining mapped
distance/time, and advances automatically along the route. GPS fixes worse than
25 m accuracy, stale fixes, and out-of-order fixes do not advance navigation.
Matching uses local progress and plausible movement so a nearby return leg does
not skip intervening turns. Progress does not regress with GPS jitter. Two fixes
at least two seconds apart, each within 10 m of a turn with accuracy at or better
than 15 m, advance the turn without requiring the resident to walk past it.
Crossings remain active until passed. The watcher requests one-second updates
with no minimum movement, so a resident waiting at a junction can still advance.

An adjusted start still requires consent before changing S. The approach stage
shows only distance/bearing, not an invented connector. Destination guidance
starts when both GPS distance to S and reported accuracy are within 20 m, or
after explicit manual arrival confirmation. Arrival at the destination also
requires proximity, sufficient route progress, and accurate GPS. Without location
permission, instructions remain manually reviewable. The watcher is removed on
pause, close, profile change, completion, or unmount. Background tracking is not enabled.

The navigation map has a current-action banner, next-action strip, live location
arrow, destination, remaining distance/time, route overview, recenter, voice
mute/repeat, and Exit controls. Android Back returns to planning. Camera following
pauses while the resident touches the map; recenter resumes following.
The arrow uses GPS direction of travel while moving, with accurate position
displacement as a fallback. Its screen rotation subtracts the actual map bearing,
including camera animation and manual map rotation. Before a travel direction is
known, the map shows a location dot instead of guessing from the planned route.
English text-to-speech announces upcoming turns, near-turn and now prompts,
rerouting and arrival. Prompts are deduplicated by route step and distance phase;
muting, route replacement and exit cancel queued speech.

`expo-speech` is a native dependency. Existing APKs built without it keep visual
navigation and show an explanation, rather than crashing. Enabling voice requires
one new development APK containing that module; Metro or EAS Update alone cannot
add native code. This change does not automatically submit any cloud build.

When three or more accurate fixes remain farther than max(12 m, 1.5 times reported
accuracy) from the local route for at least four seconds, navigation automatically requests
a new backend route from GPS. Only one replan can run at a time; automatic retries
have a 15-second cooldown. Replans preserve the destination and selected route
mode/profile, pass no start-adjustment candidates, and never downgrade an
accessible route to ordinary walking. Errors retain the previous route, continue
automatic retries, and also offer Retry now. Normal navigation has no Recalculate
button. While deviation is being confirmed, stale turn instructions are hidden.
Closing navigation, changing endpoints/mode, or arrival
invalidates a pending response. The map follows accurate GPS until the resident
touches the map; Follow my location resumes camera following.
Production report/What-if data are not integrated into this independent dataset.
The internal route comparison performs no live API/database writes and needs no
additional key or SQL. Car travel only opens its provider after the resident presses
the external driving navigation button. Walking time assumes 1.2 m/s and wheelchair
time 0.9 m/s, both illustrative estimates rather than traffic or personal mobility data.

## Rebuild and verification

The Python tools use only the standard library and perform no network calls:

```sh
python src/demo/tools/build_dataset.py /path/to/kl-east.osm /tmp/rebuilt.json
python src/demo/tools/verify_osm_source.py /path/to/kl-east.osm src/demo/kl-east-demo.json
node src/demo/__tests__/network.test.cjs
node src/demo/__tests__/screen.test.cjs
node src/demo/__tests__/profiles.test.cjs
node src/demo/__tests__/driving.test.cjs
node src/demo/__tests__/access.test.cjs
node src/demo/__tests__/guidance.test.cjs
node src/demo/__tests__/navigation-progress.test.cjs
node src/demo/__tests__/navigation-voice.test.cjs
node src/demo/__tests__/navigation-heading.test.cjs
node src/demo/__tests__/navigation-view.test.cjs
python src/demo/tools/test_walking_direction.py
npx tsc --noEmit
```

The source verifier checks coverage of every eligible source segment across the
whole bbox, exact geometry, direction, OSM IDs, landmark names and positions.
17 routing checks include same-edge endpoints, partial facility intersections,
snapping, directional/disconnected cases, changed destinations and comparison
with an independent Bellman-Ford oracle on actual source graph pairs. UI
checks cover empty initial state, the absence of management controls, selection,
search, stale-route invalidation, marker events, existing app callbacks and travel
profile selection. Six profile tests check walking/wheelchair eligibility and
honest verification metadata; three driving URL tests check coordinates, validation
and isolation from credentials and fictional restrictions.
Run lint and an Android release bundle check too. These checks do not replace
phone testing of native map taps, source events, gestures and keyboard layout.

Six access regressions include the reported gate detour, an explicitly disconnected
nearest stub, fixed stair destinations and no fabricated connector. GPS-injected
guidance checks cover automatic progress, turn prompts, noisy/stale fixes,
adjusted-start arrival, completion, replan debounce/cooldown/failure, route updates,
and subscription cleanup, including in-flight operations after unmount. Map
integration checks cover retained instructions, fixed destinations/profiles,
accessible-route failures, cancellation, arrival races, and camera gestures.
Three Python checks distinguish
vehicle one-way from pedestrian direction. Native GPS/map behavior still needs a
phone test; no field survey is claimed.
