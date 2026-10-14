import "./disposable-stack-polyfill";
import type { Metadata } from "next";
import { FantasyApp } from "./fantasy-app";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pump.fun Fantasy League | Draft the Top 50",
  description: "One hour to draft five traders. Hold 500,000 FANTASY, submit your squad, then compete across 48 hours of PnL.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Pump.fun Fantasy League",
    description: "One hour to draft five traders. Hold 500,000 FANTASY, submit your squad, then compete across 48 hours of PnL.",
    images: [{ url: "/brand/fantasy-league-social.png", width: 1500, height: 500 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pump.fun Fantasy League",
    description: "One hour to draft five traders. Hold 500,000 FANTASY, submit your squad, then compete across 48 hours of PnL.",
  },
};

export default function Home() {
  // The client reads the authoritative season state through the same Railway
  // API proxy as submissions. An already-open page unlocks on the next poll.
  return <FantasyApp />;
}
