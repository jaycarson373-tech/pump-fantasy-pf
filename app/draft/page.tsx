import type { Metadata } from "next";
import { FantasyApp } from "../fantasy-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Draft Room | PumpFun Fantasy League",
  description: "Build and submit your five-trader Pump.fun fantasy squad.",
  robots: { index: false, follow: false },
};

export default function DraftRoomPage() {
  return <FantasyApp />;
}
