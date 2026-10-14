import assert from "node:assert/strict";
import test from "node:test";
import { recoverBoundaryAward } from "../lib/server/boundary-award.ts";

test("recovers a missing daily award when the scoring snapshot already exists", async () => {
  const baseline = { boundary: 0, pnl: { trader: 10 } };
  const closing = { boundary: 1, pnl: { trader: 18 } };
  const recorded = new Map();
  const recovered = await recoverBoundaryAward({
    boundary: 1,
    snapshot: closing,
    loadPrevious: async (boundary) => boundary === 0 ? baseline : undefined,
    recordAward: async (day, previous, current) => recorded.set(day, { previous, current })
  });

  assert.equal(recovered, true);
  assert.deepEqual(recorded.get(1), { previous: baseline, current: closing });
});

test("does not create an award for the opening baseline", async () => {
  let awardCalls = 0;
  const recovered = await recoverBoundaryAward({
    boundary: 0,
    snapshot: { boundary: 0 },
    loadPrevious: async () => undefined,
    recordAward: async () => { awardCalls += 1; }
  });

  assert.equal(recovered, false);
  assert.equal(awardCalls, 0);
});

test("waits for the preceding score snapshot before recording an award", async () => {
  let awardCalls = 0;
  const recovered = await recoverBoundaryAward({
    boundary: 2,
    snapshot: { boundary: 2 },
    loadPrevious: async () => undefined,
    recordAward: async () => { awardCalls += 1; }
  });

  assert.equal(recovered, false);
  assert.equal(awardCalls, 0);
});
