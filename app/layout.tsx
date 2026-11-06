import type { Metadata } from "next";
import { Geist, Geist_Mono, Barlow_Condensed } from "next/font/google";
import "./globals.css";
import "./club-identity.css";
import { Providers } from "./providers";

const leagueDisplay = Barlow_Condensed({
  variable: "--font-league",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.pfleague.fun"),
  title: "Pump Fantasy League | Draft the trenches",
  description:
    "Draft seven Pump.fun traders. Four tiers, one captain, weekly competition and PFL rewards.",
  icons: {
    icon: "/brand/pfl-crest.svg",
    shortcut: "/brand/pfl-crest.svg",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "Pump Fantasy League",
    description:
      "100 traders. Seven starters. One captain. Compete in Pump Fantasy League.",
    images: [{ url: "/brand/pfl-social.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pump Fantasy League",
    description:
      "100 traders. Seven starters. One captain. Compete in Pump Fantasy League.",
    images: ["/brand/pfl-social.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${leagueDisplay.variable}`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
