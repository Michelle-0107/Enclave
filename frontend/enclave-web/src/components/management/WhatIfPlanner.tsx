"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  compareRepairPlans,
  getRepairCandidates,
  resolveMapLocationName,
  type FacilityIssue,
  type MapLocationName,
  type WhatIfPath,
  type WhatIfPlan,
  type WhatIfResult,
} from "@/lib/api";

import RepairPlanRoutes from "./RepairPlanRoutes";
import RepairSummaryPanel from "./RepairSummaryPanel";

import WhatIfPathMap, {
  parseMapPoint,
  pathDistance,
  type PickTarget,
} from "./WhatIfPathMap";

type JourneyForm = {
  name: string;
  fromLat: string;
  fromLng: string;
  toLat: string;
  toLng: string;
};
type PlanForm = {
  name: string;
  facilities: string[];
  costs: Record<string, string>;
};
type LocationLookup = MapLocationName & { status: "loading" | "ready" | "unavailable" };

const blankJourney = (): JourneyForm => ({
  name: "",
  fromLat: "",
  fromLng: "",
  toLat: "",
  toLng: "",
});
const blankPlan = (index: number): PlanForm => ({
  name: `Repair plan ${index}`,
  facilities: [],
  costs: {},
});
const routeModes = [
  { id: "avoid_damage" as const, label: "Avoid reported damage" },
  { id: "accessible" as const, label: "Accessible route" },
];

const comparisonNoteLabels: Array<[string, string]> = [
  ["Walking simulations share", "Walking simulations use modelled facilities; they are not field verified."],
  ["Simulation only:", "Simulation only; do not use these routes for live navigation."],
  ["Major paths are", "Paths are management-defined journeys, counted once across route modes."],
  ["Affected counts", "Affected paths cross selected damage zones on the damage-free reference route."],
  ["Before and after routes use", "Before and after routes share fixed endpoints."],
  ["Mapped demo facilities", "Facility zones are approximate unless linked to mapped road segments."],
  ["Each comparison rechecks", "Each plan keeps the shortest valid route around remaining damage."],
  ["Accessible fallback routes", "Unverified walking references and unassessed links do not count as accessible."],
  ["Route modes are summarized", "Paths are management-defined journeys, counted once across route modes."],
  ["Costs are management-entered", "MYR costs are estimates; missing prices remain unknown."],
  ["Unknown, unassessed, or inaccessible", "Unverified walking references and unassessed links do not count as accessible."],
  ["Road geometry and damage zones", "Repair benefits are measured per plan within the KL East pilot."],
];

// Keep existing comparisons readable while the API update is rolling out.
function comparisonNotes(warnings: string[]) {
  return [...new Set(warnings.map(warning =>
    comparisonNoteLabels.find(([prefix]) => warning.startsWith(prefix))?.[1] ?? warning,
  ))];
}

const MAX_PATHS = 10;
const MAX_PLANS = 5;

function locationLookupKey(index: number, latitude: string, longitude: string) {
  return `${index}:${latitude.trim()}:${longitude.trim()}`;
}

export default function WhatIfPlanner() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pickTargets, setPickTargets] = useState<Record<number, PickTarget>>(
    {},
  );
  const [issues, setIssues] = useState<FacilityIssue[]>([]);
  const [journeys, setJourneys] = useState<JourneyForm[]>([blankJourney()]);
  const [locationLookups, setLocationLookups] = useState<Record<string, LocationLookup>>({});
  const [coordinateEditors, setCoordinateEditors] = useState<Record<string, boolean>>({});
  const completedLocationLookups = useRef(new Set<string>());
  const [plans, setPlans] = useState<PlanForm[]>([blankPlan(1)]);
  const [modes, setModes] = useState<Array<"avoid_damage" | "accessible">>([
    "avoid_damage",
    "accessible",
  ]);
  const [budget, setBudget] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [selectedRoute, setSelectedRoute] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");

  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true);
    setError("");
    try {
      const response = await getRepairCandidates();
      setIssues(response.issues);
      setResult(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load current repair candidates.",
      );
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getRepairCandidates()
      .then((response) => {
        if (active) setIssues(response.issues);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load current repair candidates.",
          );
      })
      .finally(() => {
        if (active) setLoadingCandidates(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timers: number[] = [];
    for (const [index, path] of journeys.entries()) {
      for (const [latitude, longitude] of [[path.fromLat, path.fromLng], [path.toLat, path.toLng]]) {
        const point = parseMapPoint(latitude, longitude);
        if (!point) continue;
        const key = locationLookupKey(index, latitude, longitude);
        if (completedLocationLookups.current.has(key)) continue;
        timers.push(window.setTimeout(() => {
          setLocationLookups((items) => ({ ...items, [key]: { matched: false, name: null, status: "loading" } }));
          resolveMapLocationName(point)
            .then((result) => {
              if (active) {
                completedLocationLookups.current.add(key);
                setLocationLookups((items) => ({ ...items, [key]: { ...result, status: "ready" } }));
              }
            })
            .catch(() => {
              if (active) {
                completedLocationLookups.current.add(key);
                setLocationLookups((items) => ({ ...items, [key]: { matched: false, name: null, status: "unavailable" } }));
              }
            });
        }, 350));
      }
    }
    return () => {
      active = false;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [journeys]);

  const facilities = useMemo(() => {
    const byId = new Map<string, FacilityIssue[]>();
    for (const issue of issues)
      byId.set(issue.facility_id, [
        ...(byId.get(issue.facility_id) ?? []),
        issue,
      ]);
    return [...byId.entries()].map(([id, incidents]) => ({
      id,
      incidents,
      sample: incidents[0],
    }));
  }, [issues]);

  function patchJourney(index: number, patch: Partial<JourneyForm>) {
    setJourneys((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
    setResult(null);
  }

  function patchPlan(index: number, patch: Partial<PlanForm>) {
    setPlans((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
    setResult(null);
  }

  function toggleFacility(
    planIndex: number,
    facilityId: string,
    checked: boolean,
  ) {
    const plan = plans[planIndex];
    if (!plan) return;
    if (checked && plan.facilities.length >= 20) {
      setError("A repair plan can include at most 20 facilities.");
      return;
    }
    patchPlan(planIndex, {
      facilities: checked
        ? [...plan.facilities, facilityId]
        : plan.facilities.filter((id) => id !== facilityId),
    });
    setError("");
  }

  function validatePaths(): string {
    if (journeys.length < 1 || journeys.length > MAX_PATHS) return 'Add between 1 and 10 paths.';
    for (const path of journeys) {
      if (!path.name.trim()) return 'Give every path a name.';
      if ([path.fromLat, path.fromLng, path.toLat, path.toLng].some(value => value.trim() === '' || !Number.isFinite(Number(value)))) return 'Choose a starting point and destination for every path.';
      const origin = parseMapPoint(path.fromLat, path.fromLng);
      const destination = parseMapPoint(path.toLat, path.toLng);
      if (!origin || !destination) return 'All endpoints must be inside the KL East pilot area.';
      if (pathDistance(origin, destination) < 5) return 'Starting point and destination must be at least 5 metres apart.';
    }
    return '';
  }

  function continueToPlans() {
    const message = validatePaths();
    setError(message);
    if (message) return;
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (modes.length === 0) {
      setError("Select at least one route type.");
      return;
    }
    const pathError = validatePaths();
    if (pathError) { setError(pathError); setStep(1); return; }
    if (!plans.length || plans.length > MAX_PLANS) { setError('Add between 1 and 5 repair plans.'); return; }
    if (plans.some((plan) => plan.facilities.length === 0)) {
      setError("Select at least one candidate facility in every repair plan.");
      return;
    }

    const paths: WhatIfPath[] = journeys.map((path, index) => ({
      id: `journey_${index + 1}`,
      name: path.name.trim(),
      origin: {
        latitude: Number(path.fromLat),
        longitude: Number(path.fromLng),
      },
      destination: {
        latitude: Number(path.toLat),
        longitude: Number(path.toLng),
      },
    }));
    const requestPlans: WhatIfPlan[] = plans.map((plan, index) => ({
      id: `plan_${index + 1}`,
      name: plan.name.trim() || `Repair plan ${index + 1}`,
      repairs: plan.facilities.map((facilityId) => ({
        facility_id: facilityId,
        estimated_cost_myr: plan.costs[facilityId]?.trim() || null,
      })),
    }));

    setComparing(true);
    try {
      const comparison = await compareRepairPlans({
          paths,
          plans: requestPlans,
          route_modes: modes,
          budget_myr: budget.trim() || null,
          include_geometry: true,
        });
      setResult(comparison);
      const first = comparison.baseline[0];
      setSelectedRoute(first ? `${first.path_id}:${first.route_mode}` : "");
      setStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      const message =
        reason instanceof ApiError && reason.status === 409
          ? "The candidate list changed while you were planning. Refresh candidates, review selections, and compare again."
          : reason instanceof Error
            ? reason.message
            : "Unable to compare repair plans.";
      setError(message);
    } finally {
      setComparing(false);
    }
  }

  function numericInput(
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) {
    return (
      <label className="flex flex-col gap-1 text-xs font-semibold text-primary">
        {label}
        <input
          required
          type="number"
          step="any"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-11 rounded-xl border border-border bg-white px-3 font-normal"
        />
      </label>
    );
  }

  function endpointCoordinates(
    index: number,
    name: "Start" | "Destination",
    latitude: string,
    longitude: string,
    onLatitudeChange: (value: string) => void,
    onLongitudeChange: (value: string) => void,
  ) {
    const key = locationLookupKey(index, latitude, longitude);
    const lookup = locationLookups[key];
    const editing = coordinateEditors[key] ?? false;
    const showCoordinates = lookup?.status !== "ready" || !lookup.matched || editing;

    return (
      <div className="grid gap-2 sm:col-span-2">
        {showCoordinates ? (
          <div className="grid grid-cols-2 gap-3">
            {numericInput(`${name} latitude`, latitude, onLatitudeChange)}
            {numericInput(`${name} longitude`, longitude, onLongitudeChange)}
          </div>
        ) : (
          <div className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">{name} location</p>
              <p className="truncate text-sm font-semibold text-primary">{lookup.name}</p>
            </div>
            <button
              type="button"
              aria-label={`Edit ${name.toLowerCase()} coordinates`}
              onClick={() => setCoordinateEditors((items) => ({ ...items, [key]: true }))}
              className="min-h-10 shrink-0 px-2 text-xs font-semibold text-primary underline"
            >
              Edit coordinates
            </button>
          </div>
        )}
        {lookup?.status === "loading" && (
          <p className="text-xs text-muted-foreground">Checking for a street name…</p>
        )}
        {lookup?.status === "unavailable" && (
          <p className="text-xs text-muted-foreground">Street name lookup unavailable; coordinates are shown.</p>
        )}
        {lookup?.status === "ready" && lookup.matched && editing && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Matched street: {lookup.name}</span>
            <button
              type="button"
              onClick={() => setCoordinateEditors((items) => ({ ...items, [key]: false }))}
              className="min-h-10 px-2 font-semibold text-primary underline"
            >
              Hide coordinates
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="what-if-planner flex flex-col gap-7">
      <div>
        <h1 className="text-[30px] font-semibold leading-[1.35] text-primary lg:text-[36px]">
          Repair what-if.
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Define major journeys and compare up to five independent
          multi-facility repair plans. Estimated costs and routes are simulation
          inputs; nothing is saved or changed in resident navigation.
        </p>
      </div>

      <nav aria-label="Repair comparison progress" className="grid grid-cols-3 gap-2 rounded-2xl border bg-card p-2">
        {([{ n: 1, label: 'Paths' }, { n: 2, label: 'Repair plans' }, { n: 3, label: 'Results' }] as const).map(item => <div key={item.n} aria-current={step === item.n ? 'step' : undefined} className={`flex min-h-12 items-center justify-center rounded-xl px-2 text-center text-sm font-semibold ${step === item.n ? 'what-if-progress-current' : item.n < step ? 'text-primary' : 'text-muted-foreground'} ${item.n === 3 && !result ? 'opacity-50' : ''}`}>{item.n}. {item.label}</div>)}
      </nav>
      <p role="status" className="text-sm text-muted-foreground">{step === 1 ? 'Step 1 · Name your paths and choose a start and destination for each.' : step === 2 ? 'Step 2 · Choose repairs, enter estimates, then compare plans.' : 'Step 3 · Review each plan on its own Before / After map.'}</p>
      <section hidden={step !== 2} className={step !== 2 ? 'hidden' : 'flex flex-col gap-3 rounded-3xl border bg-card p-5'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-primary">
              Current qualified candidates
            </h2>
            <p className="text-xs text-muted-foreground">
              Open issues reported by at least two different residents, with no approved report;
              selection is grouped by facility.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadCandidates()}
            disabled={loadingCandidates}
            className="min-h-10 rounded-xl border border-border bg-white px-4 text-xs font-semibold text-primary disabled:opacity-60"
          >
            {loadingCandidates ? "Loading…" : "Refresh candidates"}
          </button>
        </div>
        {loadingCandidates ? (
          <p className="py-3 text-sm text-muted-foreground">
            Loading candidate facilities…
          </p>
        ) : facilities.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            There are no qualified open issues to simulate right now.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {facilities.map(({ id, incidents, sample }) => (
              <li
                key={id}
                className="rounded-xl border border-border bg-white p-3 text-sm"
              >
                <p className="font-semibold text-primary">
                  {sample.facility_name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sample.facility_type} · {incidents.length} qualified issue
                  {incidents.length === 1 ? "" : "s"} ·{" "}
                  {sample.affects_routes
                    ? "affects routes"
                    : "does not affect routes"}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  {id}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={submit} onInvalid={() => setError("Complete all required fields before comparing plans.")} className={step === 3 ? "hidden" : "flex flex-col gap-7"}>
        <section className={step !== 1 ? "hidden" : "flex flex-col gap-4"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-primary">
                Management-defined major paths
              </h2>
              <p className="text-xs text-muted-foreground">
                Coordinates must be inside the KL East pilot area and each
                journey must be at least 5 m long.
              </p>
            </div>
            <button
              type="button"
              disabled={journeys.length >= MAX_PATHS}
              onClick={() => { setJourneys(items => items.length < MAX_PATHS ? [...items, blankJourney()] : items); setResult(null); }}
              className="min-h-10 rounded-xl bg-card px-3 text-xs font-semibold text-primary disabled:opacity-50"
            >
              Add path ({journeys.length}/{MAX_PATHS})
            </button>
          </div>
          {journeys.map((path, index) => (
            <fieldset
              key={index}
              className="grid gap-3 rounded-3xl border border-border p-4 sm:grid-cols-2"
            >
              <legend className="px-2 text-sm font-semibold text-primary">
                Path {index + 1}
              </legend>
              <label className="flex flex-col gap-1 text-xs font-semibold text-primary sm:col-span-2">
                Path name
                <input
                  required
                  maxLength={120}
                  value={path.name}
                  onChange={(event) =>
                    patchJourney(index, { name: event.target.value })
                  }
                  placeholder="e.g. Residence entrance to community hall"
                  className="min-h-11 rounded-xl border border-border px-3 font-normal"
                />
              </label>
              <div className="flex flex-col gap-3 sm:col-span-2">
                <p className="text-xs text-muted-foreground">
                  Select A, then click the starting point on the map. Select B
                  and click the destination. You can drag either marker to
                  adjust it.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["origin", "destination"] as const).map((target) => (
                    <button
                      key={target}
                      type="button"
                      aria-pressed={(pickTargets[index] ?? "origin") === target}
                      onClick={() =>
                        setPickTargets((items) => ({
                          ...items,
                          [index]: target,
                        }))
                      }
                      className={`min-h-11 rounded-xl border border-border px-4 text-xs font-semibold ${(pickTargets[index] ?? "origin") === target ? "what-if-toggle-selected bg-brand text-primary-foreground" : "bg-white text-primary"}`}
                    >
                      {target === "origin"
                        ? "A · Set starting point"
                        : "B · Set destination"}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      patchJourney(index, {
                        fromLat: "",
                        fromLng: "",
                        toLat: "",
                        toLng: "",
                      });
                      setPickTargets((items) => ({
                        ...items,
                        [index]: "origin",
                      }));
                    }}
                    className="min-h-11 px-3 text-xs font-semibold text-status-red underline"
                  >
                    Clear points
                  </button>
                </div>
                <WhatIfPathMap
                  origin={parseMapPoint(path.fromLat, path.fromLng)}
                  destination={parseMapPoint(path.toLat, path.toLng)}
                  target={pickTargets[index] ?? "origin"}
                  onTargetChange={(target) =>
                    setPickTargets((items) => ({ ...items, [index]: target }))
                  }
                  issues={issues}
                  onPick={(target, point) => {
                    patchJourney(
                      index,
                      target === "origin"
                        ? {
                            fromLat: point.latitude.toFixed(6),
                            fromLng: point.longitude.toFixed(6),
                          }
                        : {
                            toLat: point.latitude.toFixed(6),
                            toLng: point.longitude.toFixed(6),
                          },
                    );
                    if (target === "origin")
                      setPickTargets((items) => ({
                        ...items,
                        [index]: "destination",
                      }));
                  }}
                />
              </div>
              <details className="sm:col-span-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Edit coordinates</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {endpointCoordinates(
                index,
                "Start",
                path.fromLat,
                path.fromLng,
                (value) => patchJourney(index, { fromLat: value }),
                (value) => patchJourney(index, { fromLng: value }),
              )}
              {endpointCoordinates(
                index,
                "Destination",
                path.toLat,
                path.toLng,
                (value) => patchJourney(index, { toLat: value }),
                (value) => patchJourney(index, { toLng: value }),
              )}
                </div>
              </details>
              {journeys.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setJourneys((items) => items.filter((_, i) => i !== index));
                    setPickTargets({});
                    setResult(null);
                  }}
                  className="w-fit text-xs font-semibold text-status-red underline sm:col-span-2"
                >
                  Remove this path
                </button>
              )}
            </fieldset>
          ))}
          <button type="button" onClick={continueToPlans} className="min-h-12 rounded-2xl bg-brand px-6 text-sm font-semibold text-primary-foreground">Continue to repair plans →</button>
        </section>

        <section className={step !== 2 ? "hidden" : "flex flex-col gap-4"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-primary">
                Independent repair plans
              </h2>
              <p className="text-xs text-muted-foreground">
                Each plan can repair multiple facilities, up to 20.
              </p>
            </div>
            <button
              type="button"
              disabled={plans.length >= MAX_PLANS}
              onClick={() => {
                setPlans(items => items.length < MAX_PLANS ? [...items, blankPlan(items.length + 1)] : items);
                setResult(null);
              }}
              className="min-h-10 rounded-xl bg-card px-3 text-xs font-semibold text-primary disabled:opacity-50"
            >
              Add repair plan ({plans.length}/{MAX_PLANS})
            </button>
          </div>
          {plans.map((plan, planIndex) => (
            <fieldset
              key={planIndex}
              className="flex flex-col gap-4 rounded-3xl border border-border p-4"
            >
              <legend className="px-2 text-sm font-semibold text-primary">
                Plan {planIndex + 1}
              </legend>
              <label className="flex flex-col gap-1 text-xs font-semibold text-primary">
                Plan name
                <input
                  required
                  maxLength={120}
                  value={plan.name}
                  onChange={(event) =>
                    patchPlan(planIndex, { name: event.target.value })
                  }
                  className="min-h-11 rounded-xl border border-border px-3 font-normal"
                />
              </label>
              {facilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No facilities are currently available to select.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {facilities.map(({ id, incidents, sample }) => {
                    const checked = plan.facilities.includes(id);
                    return (
                      <li
                        key={id}
                        className="grid gap-2 rounded-xl bg-card p-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center"
                      >
                        <label className="flex items-start gap-3 text-sm text-primary">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleFacility(
                                planIndex,
                                id,
                                event.target.checked,
                              )
                            }
                            className="mt-1 size-4 accent-primary"
                          />
                          <span>
                            <span className="font-semibold">
                              {sample.facility_name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {incidents.length} issue
                              {incidents.length === 1 ? "" : "s"} ·{" "}
                              {sample.fault_kind}
                              {incidents.length > 1 ? " and others" : ""}
                            </span>
                          </span>
                        </label>
                        {checked && (
                          <label className="flex flex-col gap-1 text-xs font-semibold text-primary">
                            Estimated cost (MYR)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Unknown"
                              value={plan.costs[id] ?? ""}
                              onChange={(event) =>
                                patchPlan(planIndex, {
                                  costs: {
                                    ...plan.costs,
                                    [id]: event.target.value,
                                  },
                                })
                              }
                              className="min-h-10 rounded-lg border border-border bg-white px-3 font-normal"
                            />
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {plans.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setPlans((items) =>
                      items.filter((_, i) => i !== planIndex),
                    );
                    setResult(null);
                  }}
                  className="w-fit text-xs font-semibold text-status-red underline"
                >
                  Remove this plan
                </button>
              )}
            </fieldset>
          ))}
        </section>

        <section className={step !== 2 ? "hidden" : "flex flex-col gap-4 rounded-3xl border bg-card p-5"}>
          <h2 className="text-lg font-semibold text-primary">
            Compare settings
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {routeModes.map((mode) => (
              <label
                key={mode.id}
                className="flex items-center gap-2 text-sm text-primary"
              >
                <input
                  type="checkbox"
                  checked={modes.includes(mode.id)}
                  onChange={(event) => {
                    setModes((items) =>
                      event.target.checked
                        ? [...items, mode.id]
                        : items.filter((item) => item !== mode.id),
                    );
                    setResult(null);
                  }}
                  className="size-4 accent-primary"
                />
                {mode.label}
              </label>
            ))}
          </div>
          <label className="flex max-w-xs flex-col gap-1 text-xs font-semibold text-primary">
            Optional total budget (MYR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(event) => {
                setBudget(event.target.value);
                setResult(null);
              }}
              placeholder="No budget set"
              className="min-h-11 rounded-xl border border-border bg-white px-3 font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={comparing || loadingCandidates || facilities.length === 0}
            className="min-h-12 rounded-2xl bg-brand px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {comparing ? "Comparing routes…" : "Compare repair plans"}
          </button>
          <button type="button" onClick={() => { setStep(1); setError(''); }} className="min-h-11 rounded-2xl border bg-card px-6 text-sm font-semibold">Back to paths</button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Each comparison uses one frozen incident snapshot. It is a
            simulation only; selected repairs do not approve reports, create
            tasks, or change the live route network.
          </p>
        </section>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-status-red-bg p-4 text-sm text-status-red"
        >
          <p>{error}</p>
          {!loadingCandidates && error.toLowerCase().includes("candidate") && (
            <button
              type="button"
              onClick={() => void loadCandidates()}
              className="mt-2 font-semibold underline"
            >
              Refresh candidates
            </button>
          )}
        </div>
      )}

      {result && step === 3 && (
        <section
          aria-labelledby="results-title"
          className="flex flex-col gap-4"
        >
          <div>
            <h2
              id="results-title"
              className="text-xl font-semibold text-primary"
            >
              Comparison results
            </h2>
            <p className="text-xs text-muted-foreground">
              Snapshot {new Date(result.snapshot_at).toLocaleString()} ·{" "}
              {result.baseline_road_obstacle_count} current road restrictions ·
              simulation only
            </p>
          </div>
          {result.warnings.length > 0 && (
            <ul aria-label="Comparison notes" className="list-disc space-y-1 rounded-2xl bg-card py-3 pr-4 pl-8 text-xs leading-relaxed text-muted-foreground">
              {comparisonNotes(result.warnings).map(note => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
          {result.plans.map((plan) => (
            <article
              key={plan.id}
              className="flex min-w-0 flex-col gap-4 rounded-3xl border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold text-primary">
                  {plan.name}
                </h3>
                <span className="text-sm text-muted-foreground">
                  {plan.total_estimated_cost_myr === null
                    ? "Cost unknown"
                    : `MYR ${plan.total_estimated_cost_myr}`}{" "}
                  · budget {plan.budget_status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {plan.repaired_issue_count} issue(s) hypothetically repaired ·{" "}
                {plan.remaining_road_obstacle_count} road restriction(s) remain
                · {plan.improved_major_path_count} major path(s) improved
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {plan.summaries.map((summary) => (
                  <div
                    key={summary.route_mode}
                    className="rounded-2xl bg-card p-4"
                  >
                    <h4 className="text-sm font-semibold text-primary">
                      {summary.route_mode === "accessible"
                        ? "Accessible routes (excludes walking references)"
                        : "Avoid damage"}
                    </h4>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {summary.restored_path_count} restored ·{" "}
                      {summary.shortened_path_count} shortened ·{" "}
                      {summary.after_available_path_count}/
                      {summary.designated_path_count} available after repairs
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Distance saved on comparable paths:{" "}
                      {Math.round(
                        summary.distance_saved_on_comparable_paths_meters,
                      )}{" "}
                      m
                    </p>
                  </div>
                ))}
              </div>
              <RepairPlanRoutes key={`${result.simulation_id}-${plan.id}`} baseline={result.baseline} plan={plan} restrictions={result.routing_restrictions} candidates={issues} selectedKey={selectedRoute} onSelectionChange={setSelectedRoute} />
            </article>
          ))}
          </div>
          {(selectedRoute === 'all:avoid_damage' || selectedRoute === 'all:accessible') &&
            <RepairSummaryPanel plans={result.plans} simulationId={result.simulation_id} mode={selectedRoute === 'all:accessible' ? 'accessible' : 'avoid_damage'} />}
          <button type="button" onClick={() => setStep(2)} className="min-h-12 rounded-2xl border bg-card px-6 text-sm font-semibold">Edit repair plans</button>
        </section>
      )}
    </div>
  );
}
