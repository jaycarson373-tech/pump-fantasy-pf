import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
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
  metadataBase: new URL("https://pump-fantasy-pf.vercel.app"),
  title: "PumpFun Fantasy League | Draft your five",
  description:
    "Draft one trader from each rank band in the Pump.fun one-month top 50. Track your squad’s daily PnL change.",
  openGraph: {
    title: "PumpFun Fantasy League",
    description: "Draft one trader from each rank band. Build your five and follow the PnL race.",
    images: [{ url: "/brand/pump-fantasy-banner.png", width: 1500, height: 500 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PumpFun Fantasy League",
    description: "Draft one trader from each rank band. Build your five and follow the PnL race.",
    images: ["/brand/pump-fantasy-banner.png"],
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
