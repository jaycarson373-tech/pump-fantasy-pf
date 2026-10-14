import assert from "node:assert/strict";
import test from "node:test";
import { hasActiveSeasonRecord, hasRequiredMigrations } from "../lib/server/health-readiness.ts";

test("health requires the configured season to exist in the database", () => {
  assert.equal(hasActiveSeasonRecord(null, [{ id: "season-1" }]), false);
  assert.equal(hasActiveSeasonRecord("season-1", []), false);
  assert.equal(hasActiveSeasonRecord("season-2", [{ id: "season-1" }]), false);
  assert.equal(hasActiveSeasonRecord("season-1", [{ id: "season-1" }]), true);
});

test("health requires every current schema migration, including automatic payout columns", () => {
  const base = [
    "202610120001_pump_fantasy.sql",
    "202610120002_seed_first_season.sql",
    "202610120003_scoring_and_awards.sql",
  ];
  assert.equal(hasRequiredMigrations(base), false);
  assert.equal(hasRequiredMigrations([...base, "202610140001_automatic_award_payouts.sql"]), true);
  assert.equal(hasRequiredMigrations([...base, "unrelated-migration.sql"]), false);
});
