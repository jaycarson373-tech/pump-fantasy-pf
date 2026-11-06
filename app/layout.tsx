import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./club-identity.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.pumpfunfantasy.xyz"),
  title: "Pump Fantasy League | Draft your five",
  description:
    "Hold 500,000 PFL. Draft five traders in one hour. Compete across 48 hours of Pump.fun PnL.",
  icons: { icon: "/brand/pfl-crest.svg", shortcut: "/brand/pfl-crest.svg", apple: "/apple-icon.png" },
  openGraph: {
    title: "Pump Fantasy League",
    description: "Draft one trader from each rank band. Build your five and follow the PnL race.",
    images: [{ url: "/brand/pfl-social.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pump Fantasy League",
    description: "Draft one trader from each rank band. Build your five and follow the PnL race.",
    images: ["/brand/pfl-social.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
