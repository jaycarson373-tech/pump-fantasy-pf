import "./disposable-stack-polyfill";
import type { Metadata } from "next";
import { FantasyApp } from "./fantasy-app";

export const metadata: Metadata = {
  title: "PumpFun Fantasy League — Draft the culture",
  description:
    "Draft one trader from each Pump.fun leaderboard rank band. Build your five and track the PnL race.",
};

export default function Home() {
  return <FantasyApp />;
}
