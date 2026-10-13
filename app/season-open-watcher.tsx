"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function SeasonOpenWatcher({ opensAt }: { opensAt: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (!opensAt) return;
    const opensAtMs = Date.parse(opensAt);
    if (!Number.isFinite(opensAtMs)) return;

    let timeout: number | undefined;
    const refreshAtOpen = () => {
      const remaining = opensAtMs - Date.now();
      if (remaining <= 0) {
        router.refresh();
        timeout = window.setTimeout(refreshAtOpen, 30_000);
        return;
      }
      timeout = window.setTimeout(refreshAtOpen, Math.min(remaining + 250, 2_147_483_647));
    };

    refreshAtOpen();
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [opensAt, router]);

  return null;
}
