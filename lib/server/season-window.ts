export type SeasonSchedule = {
  status: string;
  opens_at: string | null;
  locked_at: string | null;
  closes_at: string | null;
};

export type SeasonPhase = "draft" | "scheduled" | "live" | "complete" | "misconfigured" | "inactive";

export function getSeasonPhase(season: SeasonSchedule, now = Date.now()): SeasonPhase {
  if (season.status === "complete") return "complete";
  if (season.status !== "open") return "inactive";

  const opensAt = season.opens_at ? Date.parse(season.opens_at) : Number.NaN;
  const lockedAt = season.locked_at ? Date.parse(season.locked_at) : Number.NaN;
  const closesAt = season.closes_at ? Date.parse(season.closes_at) : Number.NaN;
  if (!Number.isFinite(opensAt) || !Number.isFinite(lockedAt) || !Number.isFinite(closesAt) || opensAt >= lockedAt || lockedAt >= closesAt) {
    return "misconfigured";
  }

  if (now < opensAt) return "scheduled";
  if (now < lockedAt) return "draft";
  if (now < closesAt) return "live";
  return "complete";
}

export function canSubmitSeasonEntry(season: SeasonSchedule, now = Date.now()) {
  return season.status === "open" && getSeasonPhase(season, now) === "draft";
}

export function nextSeasonId(existingIds: string[]) {
  const existing = new Set(existingIds);
  const highest = existingIds.reduce((max, id) => {
    const match = /^season-(\d+)$/.exec(id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let next = highest + 1;
  while (existing.has(`season-${next}`)) next += 1;
  return `season-${next}`;
}
