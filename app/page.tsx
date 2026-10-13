import "./disposable-stack-polyfill";
import type { Metadata } from "next";
import { RelaunchPage } from "./relaunch-page";

export const metadata: Metadata = {
  title: "Pump.fun Fantasy League | Relaunching tomorrow",
  description: "The draft room is being rebuilt. A new season opens tomorrow.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Pump.fun Fantasy League is rebuilding",
    description: "The draft room is being rebuilt. A new season opens tomorrow.",
    images: [],
  },
  twitter: {
    card: "summary",
    title: "Pump.fun Fantasy League is rebuilding",
    description: "A new draft room and season arrive tomorrow.",
  },
};

export default function Home() {
  return <RelaunchPage />;
}
