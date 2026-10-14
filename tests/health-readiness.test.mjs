import assert from "node:assert/strict";
import test from "node:test";
import { hasActiveSeasonRecord } from "../lib/server/health-readiness.ts";

test("health requires the configured season to exist in the database", () => {
  assert.equal(hasActiveSeasonRecord(null, [{ id: "season-1" }]), false);
  assert.equal(hasActiveSeasonRecord("season-1", []), false);
  assert.equal(hasActiveSeasonRecord("season-2", [{ id: "season-1" }]), false);
  assert.equal(hasActiveSeasonRecord("season-1", [{ id: "season-1" }]), true);
});
