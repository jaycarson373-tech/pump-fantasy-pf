"use client";

import { ClientProvider } from "@solana/react";
import type { ReactNode } from "react";
import { solanaClient } from "./solana-client";

export function Providers({ children }: { children: ReactNode }) {
  return <ClientProvider client={solanaClient}>{children}</ClientProvider>;
}
