import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitSeasonEntry, getSeasonPhase, nextSeasonId } from "../lib/server/season-window.ts";

const schedule = {
  status: "open",
  opens_at: "2026-10-13T12:00:00.000Z",
  locked_at: "2026-10-13T15:00:00.000Z",
  closes_at: "2026-10-15T15:00:00.000Z",
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
