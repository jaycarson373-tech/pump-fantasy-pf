import type { Metadata } from "next";
import { FantasyApp } from "./fantasy-app";

export const metadata: Metadata = {
  title: "Pump Fantasy — Draft the culture",
  description:
    "Build a five-KOL roster, track daily and weekly performance, and compete in Pump Fantasy tournaments.",
};

export default function Home() {
  return <FantasyApp />;
}
