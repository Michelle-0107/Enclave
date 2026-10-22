"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataSkeleton } from "@/components/ui/DataSkeleton";
import {
  ApiError,
  compareRepairPlans,
  getRepairCandidates,
  getRepairSummary,
  resolveMapLocationName,
  WHAT_IF_LIMITS,
  type FacilityIssue,
  type MapLocationName,
  type WhatIfPath,
  type WhatIfPlan,
  type WhatIfResult,
  type RepairSummary,
} from "@/lib/api";

import RepairPlanRoutes from "./RepairPlanRoutes";
import CandidateReviewButton from "./CandidateReviewButton";
import { formatRouteSeconds, repairPathViews, routeDistance, routeTimeChange } from "@/lib/repairRouteView";
import { ArrowLeft, ArrowRight, Copy, Plus, RotateCcw, Trash2 } from "lucide-react";

import WhatIfPathMap, {
  parseMapPoint,
  pathDistance,
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
  ["Accessible comparisons use", "Step-free comparisons use simulated facilities; routes are not field verified."],
  ["Simulation only:", "Simulation only; do not use these routes for live navigation."],
  ["Major paths are", "Paths are management-defined journeys, counted once across route modes."],
  ["Affected counts", "Affected paths cross selected damage zones on the damage-free reference route."],
  ["Before and after routes use", "Before and after routes share fixed endpoints."],
  ["Mapped demo facilities", "Facility zones are approximate unless linked to mapped road segments."],
  ["Each comparison rechecks", "Each plan keeps the shortest valid route around remaining damage."],
  ["Accessible fallback routes", "Unverified walking references and unassessed links do not count as accessible."],
  ["Route modes are summarized", "Paths are management-defined journeys, counted once across route modes."],
  ["Costs are management-entered", "MYR costs are estimates; missing prices remain unknown."],
  ["MYR estimates prefer", "Verified repair costs are used when available; provisional reference prices and manual overrides remain estimates."],
  ["Unknown, unassessed, or inaccessible", "Unverified walking references and unassessed links do not count as accessible."],
  ["Road geometry and damage zones", "Repair benefits are measured per plan within the KL East pilot."],
];

// Keep existing comparisons readable while the API update is rolling out.
function comparisonNotes(warnings: string[]) {
  return [...new Set(warnings.map(warning =>
    comparisonNoteLabels.find(([prefix]) => warning.startsWith(prefix))?.[1] ?? warning,
  ))];
}

const { paths: MAX_PATHS, plans: MAX_PLANS, repairs: MAX_REPAIRS } = WHAT_IF_LIMITS;
const PATH_COLORS = ["#2563eb", "#a855f7", "#f59e0b", "#10b981", "#ec4899", "#06b6d4", "#ef4444", "#8b5cf6", "#84cc16", "#f97316"];
const money = (value: number | string | null | undefined) => value == null || value === "" || !Number.isFinite(Number(value)) ? "Unknown" : `MYR ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const validMoney = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) <= 9999999999.99;

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-secondary ${className}`} />;
}

function WhatIfPageSkeleton() {
  return (
    <div className="what-if-planner flex flex-col gap-7" aria-busy="true" aria-label="Loading repair planner">
      <p role="status" className="sr-only">Loading repair planner</p>

      <div className="space-y-3">
        <SkeletonBlock className="h-10 w-52" />
        <SkeletonBlock className="h-4 w-full max-w-3xl" />
        <SkeletonBlock className="h-4 w-2/3 max-w-2xl" />
      </div>

      <div aria-hidden="true" className="grid grid-cols-3 gap-2 rounded-2xl border bg-card p-2">
        <SkeletonBlock className="h-12 rounded-xl bg-brand/15" />
        <SkeletonBlock className="h-12 rounded-xl" />
        <SkeletonBlock className="h-12 rounded-xl" />
      </div>

      <SkeletonBlock className="h-4 w-2/3 max-w-xl" />

      <section className="flex flex-col gap-4" aria-hidden="true">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-64 max-w-[65vw]" />
            <SkeletonBlock className="h-4 w-80 max-w-[75vw]" />
          </div>
          <SkeletonBlock className="h-10 w-32 rounded-full" />
        </div>

        <div className="rounded-3xl border border-border p-4 sm:p-5">
          <div className="space-y-4">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-11 w-full rounded-xl" />
            <SkeletonBlock className="h-4 w-3/4 max-w-2xl" />
            <div className="flex flex-wrap items-center gap-2">
              <SkeletonBlock className="h-10 w-36 rounded-full" />
              <SkeletonBlock className="h-10 w-32 rounded-full" />
              <SkeletonBlock className="h-4 w-20" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SkeletonBlock className="h-5 w-40" />
              <SkeletonBlock className="h-11 w-32 rounded-xl" />
            </div>
            <div className="relative h-[420px] overflow-hidden rounded-2xl border border-border bg-[#edf0ed] sm:h-[520px]">
              <div className="absolute inset-0 animate-pulse">
                <div className="absolute left-[5%] top-[8%] h-[30%] w-[30%] rounded-2xl bg-[#dfe9dc]" />
                <div className="absolute right-[7%] top-[12%] h-[38%] w-[26%] rounded-2xl bg-[#dfe9dc]" />
                <div className="absolute bottom-[8%] left-[28%] h-[26%] w-[35%] rounded-2xl bg-[#e4e7e2]" />
                <div className="absolute left-[-8%] top-[43%] h-7 w-[116%] rotate-[-9deg] bg-white/90" />
                <div className="absolute left-[42%] top-[-10%] h-[125%] w-6 rotate-[16deg] bg-white/90" />
                <div className="absolute left-[16%] top-[35%] h-3 w-[24%] rotate-[22deg] rounded-full bg-white/80" />
                <div className="absolute right-[16%] bottom-[26%] h-3 w-[20%] rotate-[-18deg] rounded-full bg-white/80" />
              </div>
            </div>
            <SkeletonBlock className="h-3 w-3/4 max-w-2xl" />
          </div>
        </div>
      </section>
    </div>
  );
}

function locationLookupKey(index: number, latitude: string, longitude: string) {
  return `${index}:${latitude.trim()}:${longitude.trim()}`;
}

export default function WhatIfPlanner() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);
  const [selectedPlanIndex, setSelectedPlanIndex] = useState(0);
  const [summary, setSummary] = useState<RepairSummary | null>(null);
  const summaryMode = selectedRoute.endsWith(":accessible") || selectedRoute === "all:accessible"
    ? "accessible" : modes.includes("avoid_damage") ? "avoid_damage" : "accessible";
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [initialCandidatesLoaded, setInitialCandidatesLoaded] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [summaryFailure, setSummaryFailure] = useState<{ key: string; message: string } | null>(null);
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const comparisonInputs = JSON.stringify({ journeys, plans, modes, budget, issues });
  const comparisonInputsRef = useRef(comparisonInputs);
  useEffect(() => { comparisonInputsRef.current = comparisonInputs; }, [comparisonInputs]);

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
        if (active) {
          setLoadingCandidates(false);
          setInitialCandidatesLoaded(true);
        }
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
  const mapPaths = useMemo(() => journeys.map(path => ({
    name: path.name,
    origin: parseMapPoint(path.fromLat, path.fromLng),
    destination: parseMapPoint(path.toLat, path.toLng),
  })), [journeys]);
  const selectedPlan = plans[selectedPlanIndex] ?? plans[0];
  const selectedResultPlan = result?.plans[selectedPlanIndex] ?? result?.plans[0];
  const selectedFacilities = useMemo(() => selectedPlan?.facilities ?? [], [selectedPlan]);
  const budgetAmount = budget.trim() === "" ? null : Number(budget);
  const planCosts = selectedPlan?.facilities.map(id => {
    const candidate = facilities.find(item => item.id === id)?.sample;
    const raw = selectedPlan.costs[id] ?? candidate?.estimated_cost_myr ?? "";
    return raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  }) ?? [];
  const knownCost = planCosts.reduce<number>((total, value) => total + (value ?? 0), 0);
  const unknownCostCount = planCosts.filter(value => value === null).length;
  const budgetPercent = budgetAmount && budgetAmount > 0 ? Math.round(knownCost / budgetAmount * 100) : 0;

  function endpointLabel(index: number, latitude: string, longitude: string) {
    const point = parseMapPoint(latitude, longitude);
    if (!point) return "Choose on map";
    const lookup = locationLookups[locationLookupKey(index, latitude, longitude)];
    return lookup?.status === "ready" && lookup.matched && lookup.name
      ? lookup.name : `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
  }

  // Keep the backend's source-backed suggestion visible until management edits it.
  function costFor(plan: PlanForm, facility: FacilityIssue) {
    return plan.costs[facility.facility_id] ?? facility.estimated_cost_myr ?? "";
  }

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
    if (checked && plan.facilities.length >= MAX_REPAIRS) {
      setError(`A repair plan can include at most ${MAX_REPAIRS} facilities.`);
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
    if (journeys.length < 1 || journeys.length > MAX_PATHS) return `Add between 1 and ${MAX_PATHS} paths.`;
    const endpointPairs = new Set<string>();
    for (const path of journeys) {
      if (!path.name.trim()) return 'Give every path a name.';
      if ([path.fromLat, path.fromLng, path.toLat, path.toLng].some(value => value.trim() === '' || !Number.isFinite(Number(value)))) return 'Choose a starting point and destination for every path.';
      const origin = parseMapPoint(path.fromLat, path.fromLng);
      const destination = parseMapPoint(path.toLat, path.toLng);
      if (!origin || !destination) return 'All endpoints must be inside the KL East pilot area.';
      if (pathDistance(origin, destination) < 5) return 'Starting point and destination must be at least 5 metres apart.';
      const pair = `${origin.latitude}:${origin.longitude}:${destination.latitude}:${destination.longitude}`;
      if (endpointPairs.has(pair)) return 'Each path needs a different start and destination pair. Adjust the copied path before comparing.';
      endpointPairs.add(pair);
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
    if (!plans.length || plans.length > MAX_PLANS) { setError(`Add between 1 and ${MAX_PLANS} repair plans.`); return; }
    if (plans.some((plan) => plan.facilities.length === 0)) {
      setError("Select at least one candidate facility in every repair plan.");
      return;
    }
    if (budget.trim() && !validMoney(budget.trim())) {
      setError("Enter a non-negative budget in MYR, with at most two decimal places and ten digits before the decimal point.");
      return;
    }
    for (const plan of plans) {
      for (const facilityId of plan.facilities) {
        const estimate = plan.costs[facilityId] ?? facilities.find(item => item.id === facilityId)?.sample.estimated_cost_myr ?? "";
        if (estimate.trim() && !validMoney(estimate.trim())) {
          setError(`Check the estimated cost in ${plan.name || "a repair plan"}. Use a non-negative MYR amount with at most two decimal places.`);
          return;
        }
      }
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
        // Null requests a fresh backend estimate from the comparison snapshot.
        estimated_cost_myr: plan.costs[facilityId]?.trim() || null,
      })),
    }));

    const submittedInputs = comparisonInputs;
    setComparing(true);
    try {
      const comparison = await compareRepairPlans({
          paths,
          plans: requestPlans,
          route_modes: modes,
          budget_myr: budget.trim() || null,
          include_geometry: true,
        });
      if (comparisonInputsRef.current !== submittedInputs) return;
      setResult(comparison);
      setSelectedPlanIndex(0);
      setSummary(null);
      setSummaryFailure(null);
      setSummaryAttempt(0);
      const first = comparison.baseline[0];
      setSelectedRoute(first ? `${first.path_id}:${first.route_mode}` : "");
      setStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      if (comparisonInputsRef.current !== submittedInputs) return;
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

  useEffect(() => {
    if (!result) return;
    let active = true;
    const key = `${result.simulation_id}:${summaryMode}`;
    getRepairSummary(result.simulation_id, summaryMode)
      .then(value => { if (active) { setSummary(value); setSummaryFailure(null); } })
      .catch(() => { if (active) { setSummary(null); setSummaryFailure({ key, message: "AI summary is unavailable. Route comparisons, entered repair prices and budget remain available above. If the comparison expired, run Compare again." }); } });
    return () => { active = false; };
  }, [result, summaryMode, summaryAttempt]);

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
              className="min-h-10 shrink-0 px-2 text-xs font-semibold text-primary underline transition-all duration-200 hover:-translate-y-0.5 hover:text-[#526B8A] hover:underline-offset-4 active:translate-y-0"
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
              className="min-h-10 px-2 font-semibold text-primary underline transition-all duration-200 hover:-translate-y-0.5 hover:text-[#526B8A] hover:underline-offset-4 active:translate-y-0"
            >
              Hide coordinates
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!initialCandidatesLoaded) return <WhatIfPageSkeleton />;

  const resultMode = summaryMode;
  const visibleSummary = summary?.facts.route_mode === resultMode ? summary : null;
  const visibleSummaryFailure = result && summaryFailure?.key === `${result.simulation_id}:${resultMode}` ? summaryFailure.message : null;
  const planFact = visibleSummary?.facts.plans.find(item => item.id === selectedResultPlan?.id);
  const planModeSummary = selectedResultPlan?.summaries.find(item => item.route_mode === resultMode);
  const simulatedAccessible = result?.warnings.some(warning => warning.startsWith("Accessible comparisons use")) ?? false;
  const resultViews = selectedResultPlan ? repairPathViews(result?.baseline ?? [], selectedResultPlan.paths).filter(view => view.mode === resultMode) : [];
  const comparableViews = resultViews.filter(view => !view.before.reference && !view.after.reference && view.before.route?.duration_seconds != null && view.after.route?.duration_seconds != null);
  const savedSeconds = comparableViews.reduce((total, view) => {
    const before = view.before.route?.duration_seconds;
    const after = view.after.route?.duration_seconds;
    return total + (!view.before.reference && !view.after.reference && before != null && after != null ? before - after : 0);
  }, 0);
  const comparableTimeChange = planFact && visibleSummary?.facts.comparable_path_count
    ? planFact.saved_seconds : comparableViews.length ? savedSeconds : null;
  const recommended = visibleSummary?.facts.recommended_plan_ids ?? [];

  return (
    <div className="what-if-planner flex flex-col gap-5 text-[#101b34]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-slate-500">Enclave Portal / Management</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Repair what-if</h1>
          <p className="mt-1 text-sm text-slate-500">Compare management-defined journeys and hypothetical repairs in the KL East pilot area.</p>
        </div>
        <nav aria-label="Repair comparison progress" className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1.5">
          {([{ number: 1, label: `Paths (${journeys.length})` }, { number: 2, label: "Repair plans" }, { number: 3, label: "Results" }] as const).map(item => (
            <button key={item.number} type="button"
              onClick={() => { if (item.number === 2) continueToPlans(); else { setStep(item.number); setError(""); } }}
              aria-current={step === item.number ? "step" : undefined}
              className={`rounded-xl px-4 py-2 text-xs font-bold ${step === item.number ? "bg-brand text-white" : "text-slate-600 hover:bg-white"}`}>
              <span className={`mr-2 inline-grid size-5 place-items-center rounded-full ${step === item.number ? "bg-blue-600 text-white" : "bg-slate-300 text-slate-700"}`}>{item.number}</span>{item.label}
            </button>
          ))}
        </nav>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {step === 1 && <section aria-label="Define journey paths" className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-extrabold">Step 1 · Define Journeys & Compare Paths</h2>
          <p className="mt-1 text-sm text-slate-500">Name each journey and choose endpoints on the real map. Up to {MAX_PATHS} paths can be compared.</p>
        </div>
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(330px,42%)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div><h3 className="font-bold">Active Journey Paths</h3><p className="text-xs text-slate-500">Select a card or map connector to focus a path.</p></div>
              <button type="button" disabled={journeys.length >= MAX_PATHS} onClick={() => { setJourneys(items => [...items, blankJourney()]); setSelectedPathIndex(journeys.length); setResult(null); }} className="flex min-h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"><Plus size={16} /> Add Path ({journeys.length}/{MAX_PATHS})</button>
            </div>
            <div className="flex max-h-[660px] flex-col gap-3 overflow-y-auto pr-1">
              {journeys.map((path, index) => {
                const selected = index === selectedPathIndex;
                const origin = mapPaths[index]?.origin;
                const destination = mapPaths[index]?.destination;
                return <article key={index} onClick={() => setSelectedPathIndex(index)} className={`cursor-pointer rounded-xl border p-3 ${selected ? "border-blue-400 bg-blue-50/60 ring-2 ring-blue-100" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-bold"><span className="size-3 rounded-full" style={{ background: PATH_COLORS[index] }} />Path {index + 1}{origin && destination && <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-normal text-slate-600">{Math.round(pathDistance(origin, destination))} m direct</span>}</div>
                    <div className="flex items-center gap-1">
                      <button type="button" title="Duplicate path" aria-label={`Duplicate path ${index + 1}`} disabled={journeys.length >= MAX_PATHS} onClick={event => { event.stopPropagation(); setJourneys(items => [...items, { ...path, name: path.name ? `${path.name} copy` : "" }]); setSelectedPathIndex(journeys.length); setResult(null); }} className="rounded p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-40"><Copy size={15} /></button>
                      <button type="button" title="Remove path" aria-label={`Remove path ${index + 1}`} disabled={journeys.length === 1} onClick={event => { event.stopPropagation(); setJourneys(items => items.filter((_, i) => i !== index)); setSelectedPathIndex(Math.max(0, Math.min(selectedPathIndex, journeys.length - 2))); setResult(null); }} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><Trash2 size={15} /></button>
                    </div>
                  </div>
                  {selected ? <div className="mt-2 space-y-3">
                    <label className="block text-xs font-semibold">Path name<input required maxLength={120} value={path.name} onChange={event => patchJourney(index, { name: event.target.value })} onClick={event => event.stopPropagation()} placeholder="e.g. Residence entrance to mall" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal" /></label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-2"><p className="text-[10px] font-bold uppercase text-emerald-600">A · Start</p><p className="truncate text-xs" title={endpointLabel(index, path.fromLat, path.fromLng)}>{endpointLabel(index, path.fromLat, path.fromLng)}</p></div>
                      <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-2"><p className="text-[10px] font-bold uppercase text-rose-600">B · Destination</p><p className="truncate text-xs" title={endpointLabel(index, path.toLat, path.toLng)}>{endpointLabel(index, path.toLat, path.toLng)}</p></div>
                    </div>
                    <details onClick={event => event.stopPropagation()} className="text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Edit coordinates</summary><div className="mt-2 grid gap-3">{endpointCoordinates(index, "Start", path.fromLat, path.fromLng, value => patchJourney(index, { fromLat: value }), value => patchJourney(index, { fromLng: value }))}{endpointCoordinates(index, "Destination", path.toLat, path.toLng, value => patchJourney(index, { toLat: value }), value => patchJourney(index, { toLng: value }))}</div></details>
                    <button type="button" onClick={event => { event.stopPropagation(); patchJourney(index, { fromLat: "", fromLng: "", toLat: "", toLng: "" }); }} className="text-xs font-semibold text-red-600 underline">Clear points</button>
                  </div> : <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500"><span className="truncate">{path.name || "Untitled path"} · {endpointLabel(index, path.fromLat, path.fromLng)} → {endpointLabel(index, path.toLat, path.toLng)}</span><span className="shrink-0 font-semibold text-blue-600">Focus</span></div>}
                </article>;
              })}
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs"><span><strong>{journeys.length} Paths Active</strong> · {validatePaths() ? "Complete endpoints to continue" : "Ready for simulation"}</span><button type="button" onClick={continueToPlans} className="flex min-h-10 items-center gap-2 rounded-xl bg-brand px-4 font-bold text-white">Continue to Plans <ArrowRight size={15} /></button></div>
          </div>
          <div className="min-w-0 rounded-2xl bg-brand p-3 text-white shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-bold">Real map · KL East pilot area</span><span className="rounded-full border border-slate-600 px-2 py-1 text-[10px]">Selected: Path {selectedPathIndex + 1}</span></div>
            <WhatIfPathMap paths={mapPaths} selectedIndex={selectedPathIndex} onSelect={setSelectedPathIndex} issues={issues} onPick={(target, point) => patchJourney(selectedPathIndex, target === "origin" ? { fromLat: point.latitude.toFixed(6), fromLng: point.longitude.toFixed(6) } : { toLat: point.latitude.toFixed(6), toLng: point.longitude.toFixed(6) })} />
            <div className="mt-3 flex flex-wrap gap-3 text-xs">{journeys.map((_, index) => <button type="button" key={index} onClick={() => setSelectedPathIndex(index)} className={`flex items-center gap-1 rounded-lg px-2 py-1 ${index === selectedPathIndex ? "bg-slate-800 text-white" : "text-slate-400"}`}><span className="size-2.5 rounded-full" style={{ background: PATH_COLORS[index] }} />Path {index + 1}</button>)}</div>
          </div>
        </div>
      </section>}

      {step === 2 && <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-extrabold">Step 2 · Choose Repairs & Configure Plans</h2><p className="mt-1 text-sm text-slate-500">Choose current qualified candidates, enter cost estimates, and check each plan against the budget.</p></div><button type="button" onClick={() => { setPlans(items => items.map(plan => ({ ...plan, costs: {} }))); setResult(null); }} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"><RotateCcw size={14} /> Reset cost overrides</button></div>
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">{plans.map((plan, index) => <button type="button" key={index} onClick={() => setSelectedPlanIndex(index)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${selectedPlanIndex === index ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>{plan.name || `Repair plan ${index + 1}`}</button>)}<button type="button" disabled={plans.length >= MAX_PLANS} onClick={() => { setPlans(items => [...items, blankPlan(items.length + 1)]); setSelectedPlanIndex(plans.length); }} className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-500 disabled:opacity-40">+ New Plan ({plans.length}/{MAX_PLANS})</button></div>
            {selectedPlan && <>
              <div className="flex flex-wrap items-end gap-3"><label className="min-w-[210px] flex-1 text-xs font-semibold">Plan name<input required maxLength={120} value={selectedPlan.name} onChange={event => patchPlan(selectedPlanIndex, { name: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" /></label>{plans.length > 1 && <button type="button" onClick={() => { setPlans(items => items.filter((_, i) => i !== selectedPlanIndex)); setSelectedPlanIndex(0); setResult(null); }} className="min-h-10 text-xs font-semibold text-red-600 underline">Remove plan</button>}</div>
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">Qualified Candidates</h3><button type="button" disabled={loadingCandidates} onClick={() => void loadCandidates()} className="text-xs font-semibold text-blue-600 underline">{loadingCandidates ? "Refreshing…" : "Refresh candidates"}</button></div>
              <p className="text-xs text-slate-500">Facilities are grouped from current qualified reports. Suggested costs use completed-repair history when available, otherwise clearly labelled provisional reference prices. Edit any amount to use a vendor quote.</p>
              {loadingCandidates ? <DataSkeleton rows={3} variant="card" /> : facilities.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No qualified open issues are available to simulate.</p> : <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-1">{facilities.map(({ id, incidents, sample }) => {
                const checked = selectedPlan.facilities.includes(id);
                const cost = costFor(selectedPlan, sample);
                const custom = Object.hasOwn(selectedPlan.costs, id);
                return <li key={id} className={`rounded-xl border p-3 ${checked ? "border-blue-400 bg-blue-50/40" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><label className="flex min-w-0 flex-1 items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={event => toggleFacility(selectedPlanIndex, id, event.target.checked)} className="mt-1 size-4 accent-blue-600" /><span className="min-w-0"><span className="block font-bold">{sample.facility_name}</span><span className="block text-xs text-slate-500">{sample.facility_type} · {incidents.length} qualified issue{incidents.length === 1 ? "" : "s"} · {sample.fault_kind}</span></span></label><div className="w-[150px]"><label className="block text-[10px] font-bold text-slate-500">Estimated cost · MYR<input type="number" min="0" step="0.01" placeholder="Unknown" value={cost} onChange={event => patchPlan(selectedPlanIndex, { costs: { ...selectedPlan.costs, [id]: event.target.value } })} onBlur={() => { if (selectedPlan.costs[id] === "") { const costs = { ...selectedPlan.costs }; delete costs[id]; patchPlan(selectedPlanIndex, { costs }); } }} className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-right text-xs font-bold text-slate-900" /></label><div className="mt-1 flex items-center justify-end gap-2 text-[10px]"><span className={custom ? "font-bold text-amber-700" : "text-slate-500"}>{custom ? "Custom quote" : sample.cost_estimate_source === "historical_median" ? `Historical median (${sample.cost_estimate_sample_count ?? 0})` : sample.cost_estimate_source === "provisional_benchmark" ? "Provisional reference" : sample.estimated_cost_myr != null ? "Backend estimate" : "No default estimate"}</span>{custom && <button type="button" onClick={() => { const costs = { ...selectedPlan.costs }; delete costs[id]; patchPlan(selectedPlanIndex, { costs }); }} className="font-bold text-blue-600 underline">Reset</button>}</div></div></div>
                  <p className="mt-2 text-[11px] text-slate-500">{sample.affects_routes ? "Reported as affecting routes" : "No route effect recorded"} · {sample.latitude.toFixed(6)}, {sample.longitude.toFixed(6)}</p>
                </li>;
              })}</ul>}
              <div className="border-t border-slate-100 pt-3"><div className="flex flex-wrap justify-between gap-2 text-xs font-semibold"><span>Budget used: <strong className="text-blue-600">{money(knownCost)}</strong>{budgetAmount !== null ? ` / ${money(budgetAmount)}` : " · No budget set"}</span>{budgetAmount !== null && <span>{budgetPercent}%</span>}</div>{budgetAmount !== null && <div className="mt-2 h-2 rounded-full bg-slate-100"><div className={`h-full rounded-full ${knownCost > budgetAmount ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${Math.min(100, budgetPercent)}%` }} /></div>}{unknownCostCount > 0 && <p className="mt-2 text-xs text-amber-700">{unknownCostCount} selected {unknownCostCount === 1 ? "facility has" : "facilities have"} no estimate. The total is incomplete.</p>}</div>
            </>}
          </div>
          <div className="min-w-0 rounded-2xl bg-brand p-3 text-white"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">{selectedPlan?.name} · Real map preview</h3><span className="rounded bg-slate-800 px-2 py-1 text-[10px]">Selected: {selectedPlan?.facilities.length ?? 0} / {facilities.length}</span></div><WhatIfPathMap paths={mapPaths} selectedIndex={selectedPathIndex} onSelect={setSelectedPathIndex} issues={issues} onPick={() => {}} readOnly selectedFacilities={selectedFacilities} /><p className="mt-2 text-xs text-white/80">Click a red dot to see its candidate facility name and issues. Green: selected repair candidate · Red: other candidate · Dashed paths: endpoint connectors, pending backend routing.</p></div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4"><div><h3 className="text-sm font-bold">Compare settings</h3><div className="mt-2 flex flex-wrap gap-4">{routeModes.map(mode => <label key={mode.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={modes.includes(mode.id)} onChange={event => { setModes(items => event.target.checked ? [...items, mode.id] : items.filter(item => item !== mode.id)); setResult(null); }} className="size-4 accent-blue-600" />{mode.label}</label>)}</div>{modes.includes("accessible") && <p className="mt-2 text-xs text-amber-800">Within resident demo coverage, Accessible uses simulated step-free facilities. These routes are not field verified.</p>}<label className="mt-3 block text-xs font-semibold">Optional total budget (MYR)<input type="number" min="0" step="0.01" value={budget} onChange={event => { setBudget(event.target.value); setResult(null); }} placeholder="No budget set" className="mt-1 min-h-10 w-44 rounded-lg border border-slate-200 px-3 font-normal" /></label></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setStep(1); setError(""); }} className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-100 px-4 text-xs font-bold"><ArrowLeft size={15} /> Back to Paths</button><button type="submit" disabled={comparing || loadingCandidates || facilities.length === 0} className="flex min-h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-50">{comparing ? "Comparing routes…" : "Compare Repair Plans"} <ArrowRight size={15} /></button></div></div>
        <p className="text-xs text-slate-500">Simulation only. This comparison does not approve reports, create work orders, or alter resident navigation.</p>
      </form>}

      {step === 3 && !result && <section aria-labelledby="results-title" className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Step 3 · Results</p>
        <h2 id="results-title" className="mt-2 text-xl font-extrabold text-slate-950">Compare repair plans to see results</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">The comparison uses the current repair candidates and the backend&apos;s real routes. Once it finishes, this page will show plan costs, path impact, time changes, and routes on the real map.</p>
        {validatePaths() && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">First complete your paths: {validatePaths()}</p>}
        <button type="button" onClick={() => { const pathError = validatePaths(); setStep(pathError ? 1 : 2); setError(pathError); }} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand/90">
          {validatePaths() ? "Complete paths" : "Configure and compare plans"} <ArrowRight size={16} />
        </button>
      </section>}

      {step === 3 && result && selectedResultPlan && <section aria-labelledby="results-title" className="flex flex-col gap-4">
        <div className="rounded-2xl bg-gradient-to-r from-blue-900 to-slate-950 p-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-200">Calculated repair comparison · {resultMode === "accessible" ? "Accessible" : "Avoid damage"}</p>
              {resultMode === "accessible" && simulatedAccessible && <p className="mt-1 text-xs font-semibold text-amber-200">Simulated step-free facilities · not field verified</p>}
              <h2 id="results-title" className="mt-1 text-lg font-extrabold">{recommended.length ? `Recommended: ${result.plans.filter(plan => recommended.includes(plan.id)).map(plan => plan.name).join(" / ")}` : visibleSummary ? "No time-based recommendation" : "Compare independent repair plans"}</h2>
            </div>
            <div role="group" aria-label="Result route mode" className="flex rounded-xl border border-white/20 bg-slate-900/70 p-1">
              {modes.map(mode => <button type="button" key={mode} aria-pressed={resultMode === mode} onClick={() => setSelectedRoute(`all:${mode}`)} className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${resultMode === mode ? "bg-blue-600 text-white" : "text-blue-200 hover:bg-white/10 hover:text-white"}`}>{mode === "accessible" ? "Accessible" : "Avoid damage"}</button>)}
            </div>
          </div>
          <div aria-label="Repair comparison summary" className="mt-4 space-y-3 border-t border-white/15 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-blue-400/30 bg-blue-500/20 px-3 py-1 font-semibold text-blue-200">{visibleSummary?.source === "ai" ? "AI executive summary & explanation" : visibleSummary ? "Calculated summary · AI unavailable" : "Executive summary"}</span>
                {visibleSummary && <span className="rounded-lg border border-white/10 bg-white/10 px-2.5 py-1 text-slate-200">{visibleSummary.facts.comparable_path_count} common comparable {visibleSummary.facts.comparable_path_count === 1 ? "route" : "routes"} · {visibleSummary.facts.excluded_path_count} excluded · Budget: {visibleSummary.facts.budget_myr === null ? "Not entered" : money(visibleSummary.facts.budget_myr)}</span>}
              </div>
              {visibleSummary && <span className="text-blue-200">{visibleSummary.source === "ai" ? "AI explanation · calculated ranking" : "Calculated ranking · AI unavailable"}</span>}
            </div>
            {visibleSummary ? <>
              <p className="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-sm leading-relaxed text-white">{visibleSummary.text}</p>
              <p className="text-xs leading-relaxed text-blue-100/80">{visibleSummary.facts.explanation}</p>
            </> : visibleSummaryFailure ? <div role="status" className="text-sm text-blue-100"><p>{visibleSummaryFailure}</p><button type="button" onClick={() => { setSummaryFailure(null); setSummaryAttempt(value => value + 1); }} className="mt-2 min-h-10 font-semibold text-white underline">Retry summary</button></div> : <p role="status" className="text-sm text-blue-100">Generating the summary… Route comparison is ready to use.</p>}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-blue-100">
              <span className="w-full text-blue-200">Selected plan · {selectedResultPlan.name}</span>
              <span>Cost: <strong className="text-sm text-white">{money(selectedResultPlan.total_estimated_cost_myr)}</strong></span>
              <span>Time change: <strong className="text-sm text-white">{comparableTimeChange === null ? "Unavailable" : `${formatRouteSeconds(Math.abs(comparableTimeChange))} ${comparableTimeChange >= 0 ? "saved" : "longer"}`}</strong></span>
              <span>Budget status: <strong className="text-sm text-white">{selectedResultPlan.budget_status.replaceAll("_", " ")}</strong></span>
            </div>
            {recommended.includes(selectedResultPlan.id) && <CandidateReviewButton plan={selectedResultPlan} />}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase text-slate-400">Selected plan cost</p><p className="mt-2 text-xl font-extrabold">{money(selectedResultPlan.total_estimated_cost_myr)}</p><p className="mt-1 text-xs text-slate-500">Budget: {selectedResultPlan.budget_status.replaceAll("_", " ")}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase text-slate-400">Available after repair</p><p className="mt-2 text-xl font-extrabold">{planModeSummary ? `${planModeSummary.after_available_path_count} / ${planModeSummary.designated_path_count}` : "Unavailable"}</p><p className="mt-1 text-xs text-slate-500">{planModeSummary?.restored_path_count ?? 0} newly restored · {resultMode === "accessible" ? simulatedAccessible ? "simulated step-free" : "verified accessible only" : "avoid damage"}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase text-slate-400">Time change</p><p className="mt-2 text-xl font-extrabold">{comparableViews.length ? formatRouteSeconds(Math.abs(planFact?.saved_seconds ?? savedSeconds)) : "Unavailable"}</p><p className="mt-1 text-xs text-slate-500">{comparableViews.length ? `${(planFact?.saved_seconds ?? savedSeconds) >= 0 ? "Saved" : "Longer"} on comparable ${resultMode} routes` : "No comparable route durations"}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase text-slate-400">Road restrictions left</p><p className="mt-2 text-xl font-extrabold">{selectedResultPlan.remaining_road_obstacle_count}</p><p className="mt-1 text-xs text-slate-500">From {result.baseline_road_obstacle_count} in the current snapshot</p></div>
        </div>
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Independent Multi-Plan Comparison</h3><span className="text-xs text-slate-500">{result.budget_myr === null ? "No budget set" : `${money(result.budget_myr)} budget cap`}</span></div><div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{result.plans.map((plan, index) => { const facts = visibleSummary?.facts.plans.find(item => item.id === plan.id); const selected = selectedResultPlan.id === plan.id; return <button type="button" key={plan.id} onClick={() => { setSelectedPlanIndex(index); setSelectedRoute(""); }} className={`what-if-plan-card rounded-xl border p-3 text-left text-xs ${selected ? "what-if-plan-card-selected border-2 border-blue-600 bg-blue-50/60" : "border-slate-200 bg-slate-50"}`}><span className="font-bold">{plan.name}</span>{recommended.includes(plan.id) && <span className="ml-2 rounded bg-amber-300 px-1 text-[10px] font-bold">Recommended</span>}<span className="mt-2 block text-slate-500">Cost: {money(plan.total_estimated_cost_myr)}</span><span className="mt-1 block font-semibold text-blue-700">{facts && visibleSummary?.facts.comparable_path_count ? `Time ${facts.saved_seconds >= 0 ? "saved" : "longer"}: ${formatRouteSeconds(Math.abs(facts.saved_seconds))}` : `${plan.improved_major_path_count} major paths improved`}</span><span className="mt-1 block text-slate-500">{plan.budget_status.replaceAll("_", " ")}</span></button>; })}</div>
            <h3 className="mt-5 text-sm font-bold">Selected Plan Impact Details · {selectedResultPlan.name}</h3><div className="mt-2 space-y-2">{resultViews.map(view => <div key={view.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{view.name}</strong><span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">{view.effect.replaceAll("_", " ")}</span></div><p className="mt-2 text-slate-600">Before: {routeDistance(view.before.route)} · {formatRouteSeconds(view.before.route?.duration_seconds)} → After: {routeDistance(view.after.route)} · {formatRouteSeconds(view.after.route?.duration_seconds)}</p><p className="mt-1 font-semibold text-blue-700">{routeTimeChange(view)}</p>{view.explanation && <p className="mt-1 text-slate-500">{view.explanation}</p>}</div>)}</div>
          </div>
          <div className="min-w-0 rounded-2xl bg-brand p-4 text-white"><h3 className="mb-3 text-sm font-bold">Spatial Route Comparison · Real map</h3><div className="rounded-xl bg-white p-3 text-slate-900"><RepairPlanRoutes key={`${result.simulation_id}-${selectedResultPlan.id}`} baseline={result.baseline} plan={selectedResultPlan} restrictions={result.routing_restrictions} candidates={issues} selectedKey={selectedRoute} onSelectionChange={setSelectedRoute} compact /></div></div>
        </div>
        {result.warnings.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500"><summary className="cursor-pointer font-bold">Methodology & disclaimers</summary><ul className="mt-2 list-disc space-y-1 pl-5">{comparisonNotes(result.warnings).map(note => <li key={note}>{note}</li>)}</ul></details>}
        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-3"><button type="button" onClick={() => { setStep(2); setError(""); }} className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-100 px-4 text-xs font-bold"><ArrowLeft size={15} /> Back to Repair Plans</button><span className="text-xs text-slate-500">Snapshot {new Date(result.snapshot_at).toLocaleString()} · Simulation only</span><CandidateReviewButton plan={selectedResultPlan} /></div>
      </section>}
    </div>
  );
}
