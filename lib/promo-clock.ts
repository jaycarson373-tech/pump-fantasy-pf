const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

export function promoSeasonClock(rounds: { ends_at: string }[], now: number) {
  const ends = rounds.map(round => Date.parse(round.ends_at));
  if (!ends.length || ends.some(end => !Number.isFinite(end)) || !Number.isFinite(now) || now <= 0) return "The title chase starts at kickoff";
  const remaining = Math.max(...ends) - now;
  if (remaining <= 0) return "Season clock complete · See the standings";
  const minutes = Math.ceil(remaining / MINUTE_MS);
  return `Season clock · ${Math.floor(minutes / DAY_MINUTES)}d ${Math.floor(minutes % DAY_MINUTES / HOUR_MINUTES)}h ${minutes % HOUR_MINUTES}m remaining`;
}
