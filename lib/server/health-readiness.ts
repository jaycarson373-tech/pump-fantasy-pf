export function hasActiveSeasonRecord(activeSeasonId: string | null, rows: Array<{ id: string }>) {
  return Boolean(activeSeasonId && rows.some((row) => row.id === activeSeasonId));
}

const REQUIRED_MIGRATIONS = [
  "202610120001_pump_fantasy.sql",
  "202610120002_seed_first_season.sql",
  "202610120003_scoring_and_awards.sql",
  "202610140001_automatic_award_payouts.sql",
  "202610140002_creator_fee_pools.sql",
];

export function hasRequiredMigrations(appliedNames: string[]) {
  const applied = new Set(appliedNames);
  return REQUIRED_MIGRATIONS.every((name) => applied.has(name));
}
