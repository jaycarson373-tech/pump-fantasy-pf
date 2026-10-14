import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitSeasonEntry, getSeasonPhase, nextSeasonId, seasonWindowFromOpen } from "../lib/server/season-window.ts";

const schedule = {
  status: "open",
  opens_at: "2026-10-13T12:00:00.000Z",
  locked_at: "2026-10-13T13:00:00.000Z",
  closes_at: "2026-10-15T13:00:00.000Z",
};

test("season phases change at the exact open, lock, and close boundaries", () => {
  const open = Date.parse(schedule.opens_at);
  const lock = Date.parse(schedule.locked_at);
  const close = Date.parse(schedule.closes_at);

  assert.equal(getSeasonPhase(schedule, open - 1), "scheduled");
  assert.equal(getSeasonPhase(schedule, open), "draft");
  assert.equal(getSeasonPhase(schedule, lock - 1), "draft");
  assert.equal(getSeasonPhase(schedule, lock), "live");
  assert.equal(getSeasonPhase(schedule, close - 1), "live");
  assert.equal(getSeasonPhase(schedule, close), "complete");
});

test("entries can only be submitted during the open draft window", () => {
  const open = Date.parse(schedule.opens_at);
  const lock = Date.parse(schedule.locked_at);

  assert.equal(canSubmitSeasonEntry(schedule, open), true);
  assert.equal(canSubmitSeasonEntry(schedule, lock), false);
  assert.equal(canSubmitSeasonEntry({ ...schedule, status: "complete" }, open), false);
});

test("invalid or incomplete season schedules fail closed", () => {
  assert.equal(getSeasonPhase({ ...schedule, locked_at: null }), "misconfigured");
  assert.equal(getSeasonPhase({ ...schedule, locked_at: schedule.opens_at }), "misconfigured");
  assert.equal(getSeasonPhase({ ...schedule, status: "draft" }), "inactive");
});

test("next season IDs advance past the highest existing number without reusing gaps", () => {
  assert.equal(nextSeasonId([]), "season-1");
  assert.equal(nextSeasonId(["season-1", "season-3"]), "season-4");
  assert.equal(nextSeasonId(["season-1", "season-3", "season-4"]), "season-5");
});

test("automatic rollover opens a one-hour draft followed by a 48-hour scoring season", () => {
  const opensAt = Date.parse("2026-10-13T12:00:00.000Z");
  const next = seasonWindowFromOpen(opensAt);

  assert.equal(Date.parse(next.opensAt), opensAt);
  assert.equal(Date.parse(next.lockedAt) - opensAt, 60 * 60 * 1000);
  assert.equal(Date.parse(next.closesAt) - Date.parse(next.lockedAt), 48 * 60 * 60 * 1000);
  assert.equal(getSeasonPhase({ status: "open", opens_at: next.opensAt, locked_at: next.lockedAt, closes_at: next.closesAt }, opensAt), "draft");
});

test("automatic rollover rejects invalid timestamps instead of writing a corrupt schedule", () => {
  assert.throws(() => seasonWindowFromOpen(Number.NaN), /Invalid season open time/);
  assert.throws(() => seasonWindowFromOpen(0), /Invalid season open time/);
});
