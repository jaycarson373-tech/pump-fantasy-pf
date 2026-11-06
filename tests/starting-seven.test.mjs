import test from "node:test";
import assert from "node:assert/strict";
import {
  TIERS,
  validatePool,
  validateRoster,
  eligibleBalance,
  makeCalendar,
  makeOpeningCalendar,
  draftOpen,
  scoreDay,
  rosterScore,
  weeklyPercentiles,
  splitFees,
  prizeShares,
  DAILY_WEIGHTS,
  SEASON_WEIGHTS,
  rankSeason,
} from "../lib/league/engine.ts";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const wallet = (n) =>
  "1".repeat(31) + alphabet[Math.floor(n / 58)] + alphabet[n % 58];
const pool = Array.from({ length: 100 }, (_, i) => ({
  id: `trader-${i + 1}`,
  wallet: wallet(i + 59),
  rank: i + 1,
  name: `Fixture ${i + 1}`,
  avatar: null,
  pnlMicros: String(1000000 - i),
  roiBps: null,
  trades: 10,
  sourceUrl: "https://example.org/test-evidence",
}));
const picks = [1, 11, 12, 31, 32, 61, 62].map((n) => `trader-${n}`);
const pnl = () => Object.fromEntries(pool.map((p) => [p.id, "0"]));
test("pool requires exactly 100 unique ranked wallets and 10/20/30/40 tiers", () => {
  assert.equal(validatePool(pool).length, 100);
  assert.deepEqual(
    TIERS.map(
      (t) => pool.filter((p) => p.rank >= t.min && p.rank <= t.max).length,
    ),
    [10, 20, 30, 40],
  );
  assert.throws(() => validatePool(pool.slice(1)));
  assert.throws(() => validatePool([...pool.slice(0, 99), pool[0]]));
  assert.throws(() =>
    validatePool(
      pool.map((p, i) => (i === 99 ? { ...p, wallet: pool[0].wallet } : p)),
    ),
  );
  assert.throws(() =>
    validatePool(
      pool.map((p, i) => (i === 99 ? { ...p, pnlMicros: "99999999999" } : p)),
    ),
  );
});
test("seven picks, exact tier counts, one selected captain, shared trader availability", () => {
  validateRoster(pool, picks, picks[0]);
  validateRoster(pool, picks, picks[0]);
  assert.throws(() => validateRoster(pool, picks.slice(1), picks[0]));
  assert.throws(() =>
    validateRoster(pool, [...picks.slice(0, 6), picks[0]], picks[0]),
  );
  assert.throws(() => validateRoster(pool, picks, "trader-100"));
  assert.throws(() =>
    validateRoster(pool, ["trader-2", ...picks.slice(0, 6)], picks[0]),
  );
});
test("eligibility accepts exactly 500000 using actual integer decimals", () => {
  assert.equal(eligibleBalance("500000000000", 6), true);
  assert.equal(eligibleBalance("500000000001", 6), true);
  assert.equal(eligibleBalance("499999999999", 6), false);
  assert.equal(eligibleBalance("250000000000", 6), false);
  assert.equal(eligibleBalance("500000", 0), true);
  assert.equal(eligibleBalance("499999", 0), false);
  assert.equal(eligibleBalance("500000000000000000000000", 18), true);
  assert.throws(() => eligibleBalance("NaN", 9));
  assert.throws(() => eligibleBalance("1", 19));
});
test("four UTC weeks with Saturday open, Monday lock and seven days", () => {
  const c = makeCalendar("2026-11-16T00:00:00Z");
  assert.equal(c.length, 4);
  assert.equal(c[0].opensAt, "2026-11-14T00:00:00.000Z");
  assert.equal(c[3].endsAt, "2026-12-14T00:00:00.000Z");
  const r = { opens_at: c[0].opensAt, locks_at: c[0].locksAt, status: "open" };
  assert.equal(draftOpen(r, Date.parse(r.opens_at)), true);
  assert.equal(draftOpen(r, Date.parse(r.locks_at)), false);
  assert.equal(
    draftOpen({ ...r, status: "locked" }, Date.parse(r.opens_at)),
    false,
  );
  assert.throws(() => makeCalendar("2026-11-17T00:00:00Z"));
  assert.throws(() => makeCalendar("2026-11-16T01:00:00Z"));
  assert.equal(makeCalendar("2026-11-16T00:00:00Z", 6).length, 6);
});
test("daily score uses only interval PnL, ties share ranks, missing data rejects", () => {
  const p = pnl();
  p["trader-1"] = "300";
  p["trader-2"] = "200";
  p["trader-3"] = "200";
  p["trader-11"] = "-100";
  p["trader-12"] = "-200";
  const s = scoreDay(pool, p);
  assert.equal(s["trader-1"] / 2, 6);
  assert.equal(s["trader-2"] / 2, 3);
  assert.equal(s["trader-3"] / 2, 3);
  assert.equal(s["trader-11"] / 2, -2);
  assert.equal(s["trader-12"] / 2, -4);
  assert.equal(s["trader-100"], 0);
  delete p["trader-99"];
  assert.throws(() => scoreDay(pool, p));
});
test("captain multiplies positive and negative points by 1.5, weekly sum is additive", () => {
  const p = pnl();
  p["trader-1"] = "10";
  p["trader-11"] = "-10";
  const s = scoreDay(pool, p);
  assert.equal(rosterScore(s, picks, "trader-1") / 2, 1);
  assert.equal(rosterScore(s, picks, "trader-11") / 2, -1);
  assert.equal(
    Array.from({ length: 7 }, () => rosterScore(s, picks, "trader-1")).reduce(
      (a, b) => a + b,
      0,
    ) / 2,
    7,
  );
});
test("season percentiles use average tied ranks and zero-sum missed weeks", () => {
  const r = weeklyPercentiles([
    { wallet: "a", points2: 10 },
    { wallet: "b", points2: 5 },
    { wallet: "c", points2: 5 },
    { wallet: "d", points2: -1 },
  ]);
  assert.deepEqual(
    r.map((x) => x.seasonPointsBps),
    [10000, 5000, 5000, 0],
  );
  assert.deepEqual(
    r.map((x) => x.rank),
    [1, 2, 2, 4],
  );
  assert.deepEqual(weeklyPercentiles([]), []);
  assert.equal(
    weeklyPercentiles([{ wallet: "a", points2: 0 }])[0].seasonPointsBps,
    10000,
  );
});
test("30/50/20 integer fee allocation always reconciles, including dust and large balances", () => {
  for (const n of [0n, 1n, 3n, 100n, 999n, 90071992547409930001n]) {
    const s = splitFees(n);
    assert.equal(s.daily + s.season + s.champion, n);
    assert.equal(s.daily, (n * 30n) / 100n);
    assert.equal(s.season, n / 2n);
  }
  assert.throws(() => splitFees(-1n));
});
test("daily, season, champion prizes retain dust and share tied prize positions", () => {
  const rows = [
    { wallet: "a", points2: 10 },
    { wallet: "b", points2: 10 },
    { wallet: "c", points2: 5 },
  ];
  const d = prizeShares(1000n, rows, DAILY_WEIGHTS);
  assert.deepEqual(d.awards, { a: 400n, b: 400n, c: 200n });
  const champ = prizeShares(101n, rows, [10000]);
  assert.deepEqual(champ.awards, { a: 50n, b: 50n, c: 0n });
  assert.equal(champ.remainder, 1n);
  const season = prizeShares(
    10000n,
    Array.from({ length: 10 }, (_, i) => ({
      wallet: String(i),
      points2: 10 - i,
    })),
    SEASON_WEIGHTS,
  );
  assert.equal(season.remainder, 0n);
  assert.equal(season.awards["9"], 500n);
  assert.equal(prizeShares(100n, [], DAILY_WEIGHTS).remainder, 100n);
});

test("season champion respects all three tiebreak levels", () => {
  const r = rankSeason([
    { wallet: "a", points: 100, fantasyPoints2: 10, bestRank: 3 },
    { wallet: "b", points: 100, fantasyPoints2: 11, bestRank: 3 },
    { wallet: "c", points: 100, fantasyPoints2: 11, bestRank: 2 },
    { wallet: "d", points: 100, fantasyPoints2: 11, bestRank: 2 },
  ]);
  assert.deepEqual(
    r.map((x) => [x.wallet, x.rank]),
    [
      ["c", 1],
      ["d", 1],
      ["b", 3],
      ["a", 4],
    ],
  );
});

test("opening draft lasts exactly 45 minutes and locks on the server boundary", () => {
  const launch = "2026-11-06T20:17:30.000Z";
  const rounds = makeOpeningCalendar(launch);
  assert.equal(rounds.length, 4);
  assert.equal(rounds[0].opensAt, launch);
  assert.equal(rounds[0].locksAt, "2026-11-06T21:02:30.000Z");
  assert.equal(rounds[0].endsAt, "2026-11-13T21:02:30.000Z");
  assert.equal(rounds[1].locksAt, rounds[0].endsAt);
  assert.equal(
    Date.parse(rounds[1].locksAt) - Date.parse(rounds[1].opensAt),
    86400000,
  );
  assert.equal(
    Date.parse(rounds[2].opensAt),
    Date.parse(rounds[1].endsAt) - 86400000,
  );
  const r = { opens_at: launch, locks_at: rounds[0].locksAt, status: "open" };
  assert.equal(draftOpen(r, Date.parse(launch) - 1), false);
  assert.equal(draftOpen(r, Date.parse(launch)), true);
  assert.equal(draftOpen(r, Date.parse(r.locks_at) - 1), true);
  assert.equal(draftOpen(r, Date.parse(r.locks_at)), false);
  assert.throws(() => makeOpeningCalendar("bad"));
});
