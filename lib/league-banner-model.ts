export type BannerSeason = {
  seasonId?: string;
  phase: string;
  schedule?: { opensAt?: string | null; lockedAt?: string | null; closesAt?: string | null } | null;
};

const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;

function deadlineText(deadline: string | null | undefined, now: number, label: string, pending: string, ended: string): string {
  const target = deadline ? Date.parse(deadline) : NaN;
  if (!Number.isFinite(target) || !Number.isFinite(now)) return pending;
  if (target <= now) return ended;
  const seconds = Math.ceil((target - now) / SECOND_MS);
  const hours = Math.floor(seconds / HOUR_SECONDS);
  const minutes = Math.floor((seconds % HOUR_SECONDS) / MINUTE_SECONDS);
  const remainder = seconds % MINUTE_SECONDS;
  const parts = [hours, minutes, remainder].map(value => String(value).padStart(2, "0"));
  return `${label} ${parts[0]}h ${parts[1]}m ${parts[2]}s`;
}

function draftText(season: BannerSeason, now: number): string {
  if (season.phase === "live" || season.phase === "complete") return "Draft locked";
  if (season.phase === "scheduled") {
    return deadlineText(season.schedule?.opensAt, now, "Draft opens in", "Draft schedule pending", "Awaiting draft update");
  }
  if (season.phase === "draft") {
    return deadlineText(season.schedule?.lockedAt, now, "Draft closes in", "Draft schedule pending", "Draft locked");
  }
  return "Draft schedule pending";
}

export function leagueBannerState(season: BannerSeason, now: number): { draft: string; season: string } {
  const draft = draftText(season, now);
  if (season.phase === "complete") return { draft, season: "Season complete" };
  if (!["scheduled", "draft", "live"].includes(season.phase)) return { draft, season: "Season schedule pending" };
  return { draft, season: deadlineText(season.schedule?.closesAt, now, "Season ends in", "Season schedule pending", "Season window ended") };
}
