import "./disposable-stack-polyfill";
import type { Metadata } from "next";
import { FantasyApp } from "./fantasy-app";
import { RelaunchPage } from "./relaunch-page";
import { getBackendConfig } from "../lib/server/config";
import { getActiveSeasonId, queryRows } from "../lib/server/database";
import { getSeasonPhase, shouldShowSeasonRoom, type SeasonPhase, type SeasonSchedule } from "../lib/server/season-window";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pump.fun Fantasy League | Draft the Top 50",
  description: "Draft five traders from the Pump.fun top 50 and follow your squad through the season.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Pump.fun Fantasy League",
    description: "Draft five traders from the Pump.fun top 50 and follow your squad through the season.",
    images: [],
  },
  twitter: {
    card: "summary",
    title: "Pump.fun Fantasy League",
    description: "Draft five traders from the Pump.fun top 50 and follow your squad through the season.",
  },
};

export default async function Home() {
  let phase: SeasonPhase | "unconfigured" = "unconfigured";
  let schedule: SeasonSchedule | null = null;

  try {
    if (getBackendConfig().ready) {
      const seasonId = await getActiveSeasonId();
      if (!seasonId) {
        phase = "inactive";
      } else {
        schedule = (await queryRows<SeasonSchedule>(
          "select status, opens_at, locked_at, closes_at from pf_seasons where id = $1 limit 1",
          [seasonId],
        ))[0] ?? null;
        phase = schedule ? getSeasonPhase(schedule) : "inactive";
      }
    }
  } catch {
    // Fail closed to the status page if the backend cannot be reached.
    phase = "unconfigured";
  }

  if (shouldShowSeasonRoom(phase)) return <FantasyApp />;
  return <RelaunchPage phase={phase} opensAt={schedule?.opens_at ?? null} />;
}
