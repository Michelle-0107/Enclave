"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  compareRepairPlans,
  getRepairCandidates,
  type FacilityIssue,
  type WhatIfPath,
  type WhatIfPlan,
  type WhatIfResult,
} from "@/lib/api";

import RepairPlanRoutes from "./RepairPlanRoutes";

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

export default function WhatIfPlanner() {
  const [pickTargets, setPickTargets] = useState<Record<number, PickTarget>>(
    {},
  );
  const [issues, setIssues] = useState<FacilityIssue[]>([]);
  const [journeys, setJourneys] = useState<JourneyForm[]>([blankJourney()]);
  const [plans, setPlans] = useState<PlanForm[]>([blankPlan(1)]);
  const [modes, setModes] = useState<Array<"avoid_damage" | "accessible">>([
    "avoid_damage",
    "accessible",
  ]);
  const [budget, setBudget] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (modes.length === 0) {
      setError("Select at least one route type.");
      return;
    }
    if (
      journeys.some((path) =>
        [path.fromLat, path.fromLng, path.toLat, path.toLng].some(
          (value) => value.trim() === "" || !Number.isFinite(Number(value)),
        ),
      )
    ) {
      setError(
        "Choose a start and destination on the map, or enter valid coordinates for every major path.",
      );
      return;
    }
    for (const journey of journeys) {
      const origin = parseMapPoint(journey.fromLat, journey.fromLng);
      const destination = parseMapPoint(journey.toLat, journey.toLng);
      if (!origin || !destination) {
        setError("All endpoints must be inside the KL East pilot area.");
        return;
      }
      if (pathDistance(origin, destination) < 5) {
        setError(
          "Starting point and destination must be at least 5 metres apart.",
        );
        return;
      }
    }
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
      name: plan.name.trim(),
      repairs: plan.facilities.map((facilityId) => ({
        facility_id: facilityId,
        estimated_cost_myr: plan.costs[facilityId]?.trim() || null,
      })),
    }));

    setComparing(true);
    try {
      setResult(
        await compareRepairPlans({
          paths,
          plans: requestPlans,
          route_modes: modes,
          budget_myr: budget.trim() || null,
          include_geometry: true,
        }),
      );
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

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[30px] font-semibold leading-[1.35] text-primary lg:text-[36px]">
          Repair what-if.
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Define major journeys and compare up to three independent
          multi-facility repair plans. Estimated costs and routes are simulation
          inputs; nothing is saved or changed in resident navigation.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-3xl bg-enclave-lavender p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-primary">
              Current qualified candidates
            </h2>
            <p className="text-xs text-muted-foreground">
              Open issues reported by at least two different residents;
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

      <form onSubmit={submit} className="flex flex-col gap-7">
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
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
              disabled={journeys.length >= 5}
              onClick={() => setJourneys((items) => [...items, blankJourney()])}
              className="min-h-10 rounded-xl bg-enclave-lavender px-3 text-xs font-semibold text-primary disabled:opacity-50"
            >
              Add path ({journeys.length}/5)
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
                      className={`min-h-11 rounded-xl border border-border px-4 text-xs font-semibold ${(pickTargets[index] ?? "origin") === target ? "bg-primary text-primary-foreground" : "bg-white text-primary"}`}
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
              {numericInput("Start latitude", path.fromLat, (value) =>
                patchJourney(index, { fromLat: value }),
              )}
              {numericInput("Start longitude", path.fromLng, (value) =>
                patchJourney(index, { fromLng: value }),
              )}
              {numericInput("Destination latitude", path.toLat, (value) =>
                patchJourney(index, { toLat: value }),
              )}
              {numericInput("Destination longitude", path.toLng, (value) =>
                patchJourney(index, { toLng: value }),
              )}
              {journeys.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setJourneys((items) => items.filter((_, i) => i !== index));
                    setResult(null);
                  }}
                  className="w-fit text-xs font-semibold text-status-red underline sm:col-span-2"
                >
                  Remove this path
                </button>
              )}
            </fieldset>
          ))}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
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
              disabled={plans.length >= 3}
              onClick={() =>
                setPlans((items) => [...items, blankPlan(items.length + 1)])
              }
              className="min-h-10 rounded-xl bg-enclave-lavender px-3 text-xs font-semibold text-primary disabled:opacity-50"
            >
              Add plan ({plans.length}/3)
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
                        className="grid gap-2 rounded-xl bg-enclave-lavender p-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center"
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

        <section className="flex flex-col gap-4 rounded-3xl bg-enclave-lavender p-5">
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
            className="min-h-12 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {comparing ? "Comparing routes…" : "Compare repair plans"}
          </button>
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

      {result && (
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
          {result.warnings.map((warning, index) => (
            <p
              key={index}
              className="rounded-xl bg-enclave-lavender p-3 text-xs leading-relaxed text-muted-foreground"
            >
              {warning}
            </p>
          ))}
          {result.plans.map((plan) => (
            <article
              key={plan.id}
              className="flex flex-col gap-4 rounded-3xl border border-border p-5"
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
                    className="rounded-2xl bg-enclave-lavender p-4"
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
              <RepairPlanRoutes key={`${result.simulation_id}-${plan.id}`} baseline={result.baseline} plan={plan} />
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
