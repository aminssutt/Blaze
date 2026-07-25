"use client";

/**
 * One-shot client fetch of the seeded scenario fixtures (units, roads,
 * resources) — the static geometry under the tactical map and the units board.
 * Same-origin static assets only (product invariant #5).
 */

import { useEffect, useState } from "react";
import {
  SCENARIO_DATA_URLS,
  type ScenarioResourcesFile,
  type ScenarioRoadsFile,
  type ScenarioUnitsFile,
} from "./scenarioData";

export interface ScenarioFixtures {
  units: ScenarioUnitsFile | null;
  roads: ScenarioRoadsFile | null;
  resources: ScenarioResourcesFile | null;
}

const EMPTY: ScenarioFixtures = { units: null, roads: null, resources: null };

let cache: ScenarioFixtures | null = null;

export function useScenario(): ScenarioFixtures {
  const [fixtures, setFixtures] = useState<ScenarioFixtures>(cache ?? EMPTY);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    async function load() {
      try {
        const [units, roads, resources] = await Promise.all([
          fetch(SCENARIO_DATA_URLS.units).then((r) => (r.ok ? r.json() : null)),
          fetch(SCENARIO_DATA_URLS.roads).then((r) => (r.ok ? r.json() : null)),
          fetch(SCENARIO_DATA_URLS.resources).then((r) => (r.ok ? r.json() : null)),
        ]);
        cache = { units, roads, resources };
        if (!cancelled) setFixtures(cache);
      } catch {
        // Missing fixtures leave the map/board on their empty states.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return fixtures;
}
