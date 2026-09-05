import "server-only";
import { getGlobal } from "@/lib/global";

const STAGES = ["migrations", "bot"] as const;

export type Stage = (typeof STAGES)[number];

const KEY = "simon.dev/readiness";

function ready(): Set<Stage> {
  return getGlobal(KEY, () => new Set<Stage>());
}

export function markReady(stage: Stage): void {
  ready().add(stage);
}

export function getPendingStages(): Stage[] {
  const done = ready();
  return STAGES.filter((stage) => !done.has(stage));
}
