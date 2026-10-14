export function hasActiveSeasonRecord(activeSeasonId: string | null, rows: Array<{ id: string }>) {
  return Boolean(activeSeasonId && rows.some((row) => row.id === activeSeasonId));
}
