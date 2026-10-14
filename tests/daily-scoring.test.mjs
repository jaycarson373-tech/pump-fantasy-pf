import assert from "node:assert/strict";
import test from "node:test";
import { calculateDailyWinner, selectStandingsSnapshots } from "../lib/server/daily-scoring.ts";

const players = Array.from({ length: 10 }, (_, index) => ({
  id: `player-${index + 1}`,
  wallet: `wallet-${index + 1}`,
}));

const entry = (wallet, start = 1) => ({
  wallet,
  picks: Array.from({ length: 5 }, (_, index) => `player-${start + index}`),
});

test("scores each squad by its five traders' PnL change across the snapshot pair", () => {
  const result = calculateDailyWinner(
    [entry("squad-a"), entry("squad-b", 6)],
    players,
    Object.fromEntries(players.map(({ wallet }) => [wallet, 100])),
    Object.fromEntries(players.map(({ wallet }, index) => [wallet, 100 + index + 1])),
  );

  assert.deepEqual(result, { kind: "winner", wallet: "squad-b", score: 40 });
});

test("breaks exact score ties deterministically by wallet", () => {
  const snapshots = Object.fromEntries(players.map(({ wallet }) => [wallet, 10]));

  assert.deepEqual(
    calculateDailyWinner([entry("wallet-z"), entry("wallet-a")], players, snapshots, snapshots),
    { kind: "winner", wallet: "wallet-a", score: 0 },
  );
});

test("does not award a winner when a picked trader is missing from either snapshot", () => {
  const before = Object.fromEntries(players.map(({ wallet }) => [wallet, 10]));
  const after = { ...before };
  delete after["wallet-3"];

  assert.deepEqual(calculateDailyWinner([entry("squad-a")], players, before, after), { kind: "awaiting-data" });
});

test("does not award malformed squads with duplicate or missing picks", () => {
  const snapshots = Object.fromEntries(players.map(({ wallet }) => [wallet, 10]));

  assert.deepEqual(
    calculateDailyWinner([{ wallet: "squad-a", picks: ["player-1", "player-1", "player-3", "player-4", "player-5"] }], players, snapshots, snapshots),
    { kind: "awaiting-data" },
  );
  assert.deepEqual(
    calculateDailyWinner([{ wallet: "squad-b", picks: ["player-1"] }], players, snapshots, snapshots),
    { kind: "awaiting-data" },
  );
});

test("records no eligible entries distinctly from incomplete scoring data", () => {
  assert.deepEqual(calculateDailyWinner([], players, {}, {}), { kind: "no-eligible-entries" });
});

test("completed standings compare the opening snapshot with the final snapshot", () => {
  const snapshots = [
    { boundary: 0, label: "opening" },
    { boundary: 1, label: "day one" },
    { boundary: 2, label: "final" },
  ];

  assert.deepEqual(selectStandingsSnapshots("complete", snapshots), {
    baseline: snapshots[0],
    current: snapshots[2],
  });
});

test("completed standings stay unscored if the final snapshot is missing", () => {
  const snapshots = [{ boundary: 0, label: "opening" }, { boundary: 1, label: "day one" }];

  assert.deepEqual(selectStandingsSnapshots("complete", snapshots), {
    baseline: snapshots[0],
    current: undefined,
  });
});

test("live standings reset to the latest daily baseline, falling back to opening", () => {
  const snapshots = [
    { boundary: 0, label: "opening" },
    { boundary: 1, label: "day one" },
  ];

  assert.deepEqual(selectStandingsSnapshots("live", snapshots), {
    baseline: snapshots[1],
    current: undefined,
  });
  assert.deepEqual(selectStandingsSnapshots("live", snapshots.slice(0, 1)), {
    baseline: snapshots[0],
    current: undefined,
  });
});
