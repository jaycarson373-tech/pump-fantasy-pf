import assert from "node:assert/strict";
import test from "node:test";
import { leagueBannerState } from "../lib/league-banner-model.ts";

const now = Date.parse("2026-11-06T12:00:00Z");
const schedule = {
  opensAt: "2026-11-06T13:00:00Z",
  lockedAt: "2026-11-06T14:00:00Z",
  closesAt: "2026-11-08T14:00:00Z",
};

test("scheduled and draft countdowns use their respective deadlines", () => {
  assert.equal(leagueBannerState({ phase: "scheduled", schedule }, now).draft, "Draft opens in 01h 00m 00s");
  assert.equal(leagueBannerState({ phase: "draft", schedule }, now).draft, "Draft closes in 02h 00m 00s");
  assert.equal(leagueBannerState({ phase: "live", schedule }, now).season, "Season ends in 50h 00m 00s");
});

test("crossing a deadline never keeps advertising an open draft", () => {
  const lock = Date.parse(schedule.lockedAt);
  assert.equal(leagueBannerState({ phase: "draft", schedule }, lock - 1).draft, "Draft closes in 00h 00m 01s");
  assert.equal(leagueBannerState({ phase: "draft", schedule }, lock).draft, "Draft locked");
  assert.equal(leagueBannerState({ phase: "scheduled", schedule }, lock).draft, "Awaiting draft update");
  assert.equal(leagueBannerState({ phase: "live", schedule }, Date.parse(schedule.closesAt)).season, "Season window ended");
});

test("missing or invalid schedule and clock remain pending", () => {
  for (const phase of ["scheduled", "draft", "live", "unconfigured", "misconfigured", "unknown"]) {
    assert.equal(leagueBannerState({ phase }, now).season, "Season schedule pending");
  }
  assert.equal(leagueBannerState({ phase: "draft", schedule: { lockedAt: "bad" } }, now).draft, "Draft schedule pending");
  assert.equal(leagueBannerState({ phase: "draft", schedule }, NaN).draft, "Draft schedule pending");
  assert.equal(leagueBannerState({ phase: "draft", schedule: null }, now).draft, "Draft schedule pending");
});

test("unconfigured and completed states do not infer availability from timestamps", () => {
  assert.deepEqual(leagueBannerState({ phase: "unconfigured", schedule }, now), { draft: "Draft schedule pending", season: "Season schedule pending" });
  assert.deepEqual(leagueBannerState({ phase: "complete", schedule }, now), { draft: "Draft locked", season: "Season complete" });
  assert.equal(leagueBannerState({ phase: "live", schedule }, now).draft, "Draft locked");
});
