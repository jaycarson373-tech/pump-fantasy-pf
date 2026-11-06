"use client";
import { useEffect, useRef, useState } from "react";
import {
  freshDraftEvents,
  formatPaid,
  type DraftActivity,
  type LeagueActivityData,
} from "../lib/league/activity";
import "./league-activity.css";
export function LeagueActivity({ showStats = true }: { showStats?: boolean }) {
  const [data, setData] = useState<LeagueActivityData | null>(null);
  const [queue, setQueue] = useState<DraftActivity[]>([]);
  const baseline = useRef<number | null>(null),
    seen = useRef(new Set<string>());
  useEffect(() => {
    let stopped = false,
      inFlight = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch("/api/league/activity", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        if (!response.ok) return;
        const next: LeagueActivityData = await response.json();
        if (stopped || next.status !== "ready" || !Array.isArray(next.events))
          return;
        const now = Date.parse(next.serverTime);
        if (!Number.isFinite(now)) return;
        // Existing entries seed the feed silently. Reloads never replay old submissions.
        if (baseline.current !== null) {
          const fresh = freshDraftEvents(
            next.events,
            seen.current,
            baseline.current,
            now,
          );
          if (fresh.length)
            setQueue((previous) => [...previous, ...fresh].slice(-20));
        } else baseline.current = now;
        next.events.forEach((event) => seen.current.add(event.id));
        // Retain recent identities without an unbounded session memory footprint.
        if (seen.current.size > 1000)
          seen.current = new Set(next.events.map((event) => event.id));
        setData(next);
      } catch {
        /* Keep the last confirmed totals; never invent activity on errors. */
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    const wake = () => void refresh();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pfl:entry-submitted", wake);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pfl:entry-submitted", wake);
    };
  }, []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(
      () => setQueue((previous) => previous.slice(1)),
      5000,
    );
    return () => clearTimeout(timer);
  }, [current]);
  const count = (value?: string) =>
    value && /^\d+$/.test(value) ? BigInt(value).toLocaleString("en-US") : "—";
  return (
    <>
      {showStats && (
        <section
          className="league-live-stats"
          aria-label="League participation and payouts"
        >
          <div>
            <span>Total entrants</span>
            <strong>{count(data?.totalEntrants)}</strong>
            <small>Unique wallets</small>
          </div>
          <div>
            <span>Drafts submitted</span>
            <strong>{count(data?.totalEntries)}</strong>
            <small>Confirmed entries</small>
          </div>
          <div>
            <span>This week’s entries</span>
            <strong>{count(data?.weeklyEntries)}</strong>
            <small>Current draft</small>
          </div>
          <div>
            <span>$PUMP paid out</span>
            <strong>
              {data?.paidRaw != null
                ? formatPaid(data.paidRaw, data.tokenDecimals)
                : "—"}
            </strong>
            <small>Confirmed transfers</small>
          </div>
        </section>
      )}
      <div
        className="draft-notification-region"
        aria-live="polite"
        aria-atomic="true"
      >
        {current && (
          <aside className="draft-notification" key={current.id}>
            <span className="entry-check" aria-hidden="true">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            </span>
            <div>
              <strong>
                {current.wallet.slice(0, 4)}…{current.wallet.slice(-4)}{" "}
                submitted their draft
              </strong>
              <p>Week {current.week} · Entry confirmed</p>
            </div>
            <button
              aria-label="Dismiss draft notification"
              onClick={() => setQueue((previous) => previous.slice(1))}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </aside>
        )}
      </div>
    </>
  );
}
