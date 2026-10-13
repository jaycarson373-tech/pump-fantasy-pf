export type ScoringBoundary = 0 | 1 | 2;
export type AwardBoundary = 1 | 2;

/** Recover an award that may not have been recorded after its score snapshot committed. */
export async function recoverBoundaryAward<TSnapshot>({
  boundary,
  snapshot,
  loadPrevious,
  recordAward
}: {
  boundary: ScoringBoundary;
  snapshot: TSnapshot;
  loadPrevious: (boundary: 0 | 1) => Promise<TSnapshot | undefined>;
  recordAward: (boundary: AwardBoundary, previous: TSnapshot, current: TSnapshot) => Promise<void>;
}) {
  if (boundary === 0) return false;

  const previous = await loadPrevious(boundary === 1 ? 0 : 1);
  if (!previous) return false;

  await recordAward(boundary, previous, snapshot);
  return true;
}
