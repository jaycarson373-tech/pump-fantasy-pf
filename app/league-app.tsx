"use client";
import Link from "next/link";
import Image from "next/image";
import { formatRewardAmount } from "../lib/reward-asset";
import { LeaguePromos } from "./league-promos";
import { promoSeasonClock } from "../lib/promo-clock";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  TIERS,
  tierFor,
  type Trader as VerifiedTrader,
} from "../lib/league/engine";
import {
  WalletControl,
  type AuthState,
  type WalletVerification,
} from "./wallet-control";
import "./starting-seven.css";
import draftCatalog from "../data/pumpfun-monthly-top100.json";
type Trader = Omit<VerifiedTrader, "trades"> & { trades: number | null };
type Page =
  "home" | "draft" | "team" | "leaderboard" | "rewards" | "rules" | "champion";
type Round = {
  id: string;
  week: number;
  status: string;
  opens_at: string;
  locks_at: string;
  ends_at: string;
  pool_hash?: string;
  pool_source?: string;
  pool_observed_at?: string;
};
type Roster = {
  wallet: string;
  picks: string[];
  captain: string;
  disqualified_at: string | null;
  disqualification_reason?: string;
  updated_at: string;
};
type Row = Roster & {
  points2: number | null;
  rank: number | null;
  eligible: string;
  rankChange: number | null;
};
type SeasonRow = {
  wallet: string;
  points: string;
  fantasy_points: string;
  best_rank: number;
  rank: number;
};
type RewardData = {
  asset: "PUMP" | "PFL";
  fees: { received: string; daily: string; season: string; champion: string; asset: "SOL" | "PUMP" };
  pools: { pool: string; raw: string }[];
  conversions: {
    signature: string;
    pool: string;
    token_raw: string;
    status: string;
  }[];
  personal: {
    id: string;
    pool: string;
    amount_raw: string;
    status: string;
    signature?: string;
    claim_status?: string | null;
  }[];
  history: {
    wallet: string;
    amount_raw: string;
    signature: string;
    pool: string;
  }[];
  payoutsActive: boolean;
  tokenDecimals: number | null;
};
type State = {
  status: string;
  tokenMint?: string | null;
  scoringDelayed?: boolean;
  message?: string | null;
  serverTime?: string;
  season?: {
    title: string;
    number: number;
    weeks: number;
    status: string;
  } | null;
  round?: Round | null;
  rounds?: Round[];
  players?: Trader[];
  roster?: Roster | null;
  boards?: { daily: Row[]; weekly: Row[]; season: SeasonRow[] };
  rewards?: RewardData | null;
  scoringDays?: {
    day: number;
    ends_at: string;
    input_hash: string;
    source: string;
  }[];
  champions?: SeasonRow[];
};
function poolAmount(rewards: RewardData | null | undefined, pool: string) {
  if (rewards?.tokenDecimals === null || rewards?.tokenDecimals === undefined) return "—";
  const raw = rewards.pools.find((p) => p.pool === pool)?.raw ?? "0";
  if (rewards.asset === "PUMP") return formatRewardAmount(raw, "PUMP");
  return Number(raw) / 10 ** rewards.tokenDecimals;
}
const EMPTY_PLAYERS: Trader[] = [];
const CATALOG_PLAYERS: Trader[] = draftCatalog.players;
const pages: [Page, string, string][] = [
  ["home", "Home", "/"],
  ["draft", "Draft", "/draft"],
  ["team", "My team", "/my-team"],
  ["leaderboard", "Leaderboard", "/leaderboard"],
  ["rewards", "Rewards", "/rewards"],
  ["rules", "Rules", "/rules"],
];
const short = (s: string) =>
  s.length > 15 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s;
const money = (s: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(s) / 1e6);
function Arrow() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.2-8.4L1 2h6.5l4.4 6.7L18.9 2ZM17.8 20h1.7L6.5 4H4.7l13.1 16Z" />
    </svg>
  );
}
function Crown() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="m3 6 5 5 4-8 4 8 5-5-2 13H5zm3 15h12v2H6z" />
    </svg>
  );
}
function Crest() {
  return (
    <Image
      src="/brand/pfl-crest.svg"
      width={48}
      height={58}
      alt="PFL league crest"
      priority
    />
  );
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="league-empty">
      <span className="empty-field" aria-hidden="true">
        <svg viewBox="0 0 60 40">
          <rect x="1" y="1" width="58" height="38" rx="3" />
          <path d="M30 1v38M1 12h9v16H1m58-16H49v16h10" />
          <circle cx="30" cy="20" r="8" />
        </svg>
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Formation({
  compact = false,
  players,
  picks,
  captain,
  editable,
  change,
}: {
  compact?: boolean;
  players: Trader[];
  picks: string[];
  captain: string;
  editable: boolean;
  change: (picks: string[], captain?: string) => void;
}) {
  return (
    <div
      className={`seven-formation ${compact ? "compact" : ""}`}
      aria-label="Seven roster slots"
    >
      <div className="pitch-lines" aria-hidden="true" />
      <div className="formation-heading">
        <span>STARTING SEVEN</span>
        <span>1 · 2 · 2 · 2</span>
      </div>
      <div className="formation-grid">
        {TIERS.flatMap((t) =>
          Array.from({ length: t.picks }, (_, slot) => {
            const p = players.filter(
              (p) => picks.includes(p.id) && tierFor(p.rank).id === t.id,
            )[slot];
            return (
              <div
                key={`${t.id}-${slot}`}
                className={`roster-slot tier-${t.id} ${p ? "filled" : ""}`}
                style={{ "--tier": t.color } as CSSProperties}
              >
                {p ? (
                  <>
                    <div className="slot-top">
                      <span>#{p.rank}</span>
                      {captain === p.id && (
                        <span className="captain-tag">
                          <Crown /> C
                        </span>
                      )}
                    </div>
                    {p.avatar ? (
                      <Image
                        src={p.avatar}
                        alt=""
                        width={60}
                        height={60}
                        unoptimized
                      />
                    ) : (
                      <div className="avatar-initial">{p.name.slice(0, 2)}</div>
                    )}
                    <strong>{p.name}</strong>
                    <small>{money(p.pnlMicros)} / 30D</small>
                    {!compact && (
                      <div className="slot-actions">
                        <button
                          disabled={!editable || picks.length !== 7}
                          aria-pressed={captain === p.id}
                          onClick={() => change(picks, p.id)}
                        >
                          {captain === p.id ? "Captain" : "Make captain"}
                        </button>
                        <button
                          disabled={!editable}
                          aria-label={`Remove ${p.name}`}
                          onClick={() =>
                            change(picks.filter((id) => id !== p.id))
                          }
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="jersey" aria-hidden="true">
                      <svg viewBox="0 0 70 70">
                        <path d="m22 9-17 9 7 15 9-4v32h28V29l9 4 7-15-17-9c-4 10-22 10-26 0z" />
                      </svg>
                      <span>{t.min === 1 ? "C" : slot + 1}</span>
                    </div>
                    <strong>{t.name}</strong>
                    <small>
                      RANK {t.min}–{t.max}
                    </small>
                  </>
                )}
              </div>
            );
          }),
        )}
      </div>
      <div className="formation-footer">
        <Crown />
        <span>
          ONE CAPTAIN. <b>1.5× POINTS.</b>
        </span>
      </div>
    </div>
  );
}
export function LeagueApp({ page = "home" }: { page?: Page }) {
  const [data, setData] = useState<State>({ status: "loading" }),
    [auth, setAuth] = useState<AuthState>({
      configured: false,
      authenticated: false,
      eligible: false,
    });
  const [selection, setSelection] = useState<{
    key: string;
    picks: string[];
    captain: string;
  }>({ key: "", picks: [], captain: "" });
  const [tier, setTier] = useState(0),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("rank"),
    [inspect, setInspect] = useState<Trader | null>(null),
    [board, setBoard] = useState<"daily" | "weekly" | "season">("weekly");
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [clock, setClock] = useState({ now: 0, offset: 0 });
  const [requestedRound, setRequestedRound] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimNotice, setClaimNotice] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const traderDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (inspect) traderDialog.current?.showModal();
  }, [inspect]);
  const verification = useRef<WalletVerification>(null),
    requestId = useRef(0),
    hydratedKey = useRef("");
  const invalidateRequests = useCallback(() => {
    requestId.current++;
  }, []);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshing(true);
    try {
      const r = await fetch(
        `/api/league${requestedRound ? `?round=${encodeURIComponent(requestedRound)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      const result: State = await r.json();
      if (id !== requestId.current) return;
      if (!r.ok) throw Error(result.message ?? "League data unavailable");
      setData(result);
      if (result.serverTime) {
        const offset = Date.parse(result.serverTime) - Date.now();
        setClock({ now: Date.now() + offset, offset });
      }
    } catch {
      if (id === requestId.current)
        setData((previous) => ({
          ...previous,
          status: "unavailable",
          message:
            "League data is temporarily unavailable. Your saved draft is safe.",
        }));
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [requestedRound]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      invalidateRequests();
    };
  }, [refresh, auth.wallet, invalidateRequests]);
  useEffect(() => {
    const t = setInterval(
      () => setClock((c) => ({ ...c, now: Date.now() + c.offset })),
      1000,
    );
    return () => clearInterval(t);
  }, []);
  const round = data.round,
    players = data.round ? (data.players ?? EMPTY_PLAYERS) : CATALOG_PLAYERS,
    key = `pfl-seven:${round?.id ?? "preseason"}:${auth.wallet ?? "guest"}`;
  const picks = selection.key === key ? selection.picks : [],
    captain = selection.key === key ? selection.captain : "";
  useEffect(() => {
    if (hydratedKey.current === key || !players.length) return;

    let next = { key, picks: [] as string[], captain: "" };
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved && Array.isArray(saved.picks)) {
        next = {
          key,
          picks: saved.picks.filter((id: string) =>
            players.some((p) => p.id === id),
          ),
          captain: saved.captain ?? "",
        };
      }
    } catch {
      /* Corrupt local drafts never override server records. */
    }
    if (data.roster)
      next = { key, picks: data.roster.picks, captain: data.roster.captain };
    else if (auth.wallet) {
      try {
        const guest = JSON.parse(
          localStorage.getItem(`pfl-seven:${round?.id ?? "preseason"}:guest`) ??
            "null",
        );
        if (guest && Array.isArray(guest.picks) && next.picks.length === 0)
          next = {
            key,
            picks: guest.picks.filter((id: string) =>
              players.some((p) => p.id === id),
            ),
            captain: guest.captain ?? "",
          };
      } catch {
        /* Corrupt local drafts never override server records. */
      }
    }
    const hydration = setTimeout(() => {
      hydratedKey.current = key;
      setSelection(next);
    }, 0);
    return () => clearTimeout(hydration);
  }, [key, round, data.roster, players, auth.wallet]);
  const entryOpen =
    data.status !== "unavailable" &&
    !!round &&
    round.status === "open" &&
    clock.now >= Date.parse(round.opens_at) &&
    clock.now < Date.parse(round.locks_at);
  const editable = !round || entryOpen;
  function change(nextPicks: string[], nextCaptain = captain) {
    const next = {
      key,
      picks: nextPicks,
      captain: nextPicks.includes(nextCaptain) ? nextCaptain : "",
    };
    setSelection(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setNotice("Browser storage is unavailable. Submit to save your lineup.");
    }
  }
  function select(p: Trader) {
    if (!editable) return;
    setNotice("");
    if (picks.includes(p.id)) {
      change(picks.filter((id) => id !== p.id));
      return;
    }
    const t = tierFor(p.rank);
    if (
      picks.filter((id) =>
        players.some((x) => x.id === id && tierFor(x.rank).id === t.id),
      ).length >= t.picks
    ) {
      setNotice(`Remove a ${t.name} pick before adding another.`);
      return;
    }
    const nextPicks = [...picks, p.id];
    change(nextPicks);
    const nextTier = TIERS.findIndex(
      (candidate) =>
        nextPicks.filter((id) =>
          players.some(
            (player) =>
              player.id === id && tierFor(player.rank).id === candidate.id,
          ),
        ).length < candidate.picks,
    );
    if (
      nextTier >= 0 &&
      nextPicks.filter((id) =>
        players.some(
          (player) => player.id === id && tierFor(player.rank).id === t.id,
        ),
      ).length === t.picks
    ) {
      setTier(nextTier);
      setSearch("");
      requestAnimationFrame(() => {
        const tabs = document.getElementById("draft-tier-navigation");
        const bounds = tabs?.getBoundingClientRect();
        if (
          tabs &&
          bounds &&
          (bounds.top < 0 || bounds.bottom > window.innerHeight)
        )
          tabs.scrollIntoView({
            block: "start",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
          });
      });
    }
  }
  async function submit() {
    if (!editable || picks.length !== 7 || !captain) return;
    if (!round) {
      change(picks, captain);
      setNotice(
        "Draft saved on this device. Competition entry is confirmed only after wallet verification and server submission.",
      );
      return;
    }
    setBusy(true);
    setNotice("");
    const originalRound = round?.id,
      originalPicks = [...picks],
      originalCaptain = captain;
    try {
      const verified = await verification.current?.verify();
      if (!verified)
        throw Error("Verify a wallet holding at least 500,000 PFL.");
      const res = await fetch("/api/league/entry", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roundId: originalRound,
          picks: originalPicks,
          captain: originalCaptain,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error ?? "Could not save lineup");
      setNotice("Lineup saved. You can edit it until draft lock.");
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not submit lineup",
      );
    } finally {
      setBusy(false);
    }
  }
  async function claimReward(entitlementId: string) {
    if (claimBusy || !auth.authenticated) return;
    setClaimBusy(true);
    setClaimNotice("");
    try {
      const res = await fetch("/api/league/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entitlementId }),
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error ?? "Could not claim reward. Try again.");
      await refresh();
    } catch (error) {
      setClaimNotice(error instanceof Error ? error.message : "Could not claim reward. Try again.");
    } finally {
      setClaimBusy(false);
    }
  }
  const rewardSymbol = data.rewards?.asset === "PFL" ? "$PFL" : "$PUMP";
  const configuredMint = "PFLnhH2Rn2kd2maipS8ueJVCojHsrnraPLn3HAQoB8W";
  const publicMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(configuredMint.trim())
    ? configuredMint.trim()
    : "";
  async function copyContract() {
    if (!publicMint) return;
    try {
      await navigator.clipboard.writeText(publicMint);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy manually");
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus(""), 2200);
  }
  const dexUrl = publicMint
    ? `https://dexscreener.com/solana/${encodeURIComponent(publicMint)}`
    : "https://dexscreener.com/solana";
  const phase = !round
    ? "Opening draft"
    : !round.pool_hash && players.length === 0
      ? "Draft field not published"
      : clock.now < Date.parse(round.opens_at)
        ? "Draft scheduled"
        : editable
          ? "Draft open"
          : clock.now < Date.parse(round.ends_at)
            ? "Scoring week"
            : "Round complete";
  const target = round
    ? clock.now < Date.parse(round.opens_at)
      ? round.opens_at
      : clock.now < Date.parse(round.locks_at)
        ? round.locks_at
        : round.ends_at
    : null;
  const remaining = target ? Math.max(0, Date.parse(target) - clock.now) : null;
  const countdown =
    remaining !== null && clock.now
      ? remaining < 3600000
        ? `${String(Math.floor(remaining / 60000)).padStart(2, "0")}:${String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}`
        : `${Math.floor(remaining / 86400000)}d ${String(Math.floor(remaining / 3600000) % 24).padStart(2, "0")}h ${String(Math.floor(remaining / 60000) % 60).padStart(2, "0")}m`
      : "45-minute opening draft";
  const visible = players
    .filter(
      (p) =>
        tierFor(p.rank).id === TIERS[tier].id &&
        `${p.name} ${p.wallet}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => (sort === "pnl-low" ? b.rank - a.rank : a.rank - b.rank));
  const authChange = useCallback((state: AuthState) => setAuth(state), []);

  return (
    <div className="pfl-app">
      <header className="pfl-header">
        <Link className="pfl-brand" href="/">
          <Crest />
          <span>
            PUMP FANTASY
            <br />
            <b>LEAGUE</b>
          </span>
        </Link>
        <nav aria-label="Primary">
          {pages.map(([id, label, url]) => (
            <Link
              key={id}
              href={url}
              aria-current={page === id ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          {publicMint && (
            <button
              className="contract-copy"
              type="button"
              onClick={() => void copyContract()}
              aria-label={`Copy PFL contract address ${publicMint}`}
            >
              <span className="contract-label">CA</span>
              <span className="contract-short">
                {copyStatus ||
                  `${publicMint.slice(0, 4)}…${publicMint.slice(-4)}`}
              </span>
              <span className="contract-full">{publicMint}</span>
              <span className="sr-only" role="status">
                {copyStatus}
              </span>
            </button>
          )}
          {publicMint && <a className="contract-explorer" href={`https://solscan.io/token/${publicMint}`} target="_blank" rel="noopener noreferrer" aria-label="View PFL token on Solscan">↗</a>}
          <a
            className="x-social"
            href="https://x.com/PFLeague_fun"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="PFL on X"
            title="@PFLeague_fun"
          >
            <XIcon />
          </a>
          <WalletControl
            onAuthChange={authChange}
            verificationRef={verification}
          />
        </div>
      </header>
      <LeaguePromos phase={phase} countdown={countdown} seasonClock={promoSeasonClock(data.rounds ?? [], clock.now)} />
      <div className="league-strip">
        <span>
          <i />
          {phase}
        </span>
        <span>
          {data.season
            ? `SEASON ${data.season.number} · WEEK ${round?.week ?? "—"}`
            : "WEEKLY DRAFTS"}
        </span>
        <span>HOLD 500,000+ $PFL</span>
        <Link className="strip-draft-link" href="/draft">
          Draft your top 7 <Arrow />
        </Link>
      </div>
      <main>
        {data.scoringDelayed && ["leaderboard", "team"].includes(page) && (
          <div className="league-connection" role="status">
            Latest scores cover completed scoring days. The next update appears
            after verification.
          </div>
        )}
        {!!data.rounds?.length && (
          <div className="round-picker">
            <label>
              Competition week{" "}
              <select
                aria-label="Competition week"
                value={requestedRound || round?.id || ""}
                onChange={(e) => setRequestedRound(e.target.value)}
              >
                {data.rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    Week {r.week} · {r.status.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {page === "home" && (
          <>
            <section className="pfl-hero">
              <div className="hero-copy">
                <p className="eyebrow">PUMP FANTASY LEAGUE / WEEKLY DRAFT</p>
                <h1>
                  DRAFT
                  <br />
                  THE <em>TRENCHES.</em>
                </h1>
                <p className="hero-description">
                  Build your seven from Pump.fun’s Top 100. Pick a captain and
                  compete for $PUMP on their trading performance.
                </p>
                <div className="hero-actions">
                  <Link className="primary-action" href="/draft">
                    DRAFT YOUR SEVEN <Arrow />
                  </Link>
                  <Link className="text-action" href="/rules">
                    Draft rules <Arrow />
                  </Link>
                </div>
                {(!round || round.week === 1) && (
                  <div className="opening-draft-clock">
                    <div>
                      <span>THE OPENING DRAFT</span>
                      <strong>
                        {!round
                          ? "Build your Week 1 lineup"
                          : editable
                            ? "Lineups lock in"
                            : phase}
                      </strong>
                    </div>
                    <div>
                      <b>{!round ? "45 MIN" : countdown}</b>
                      <small>
                        {!round ? "ENTRY WINDOW" : "SERVER TIME · UTC"}
                      </small>
                    </div>
                    <p>
                      Hold 500,000+ PFL. Submit your seven before the clock runs
                      out.
                    </p>
                  </div>
                )}
                <div className="hero-numbers">
                  <div>
                    <b>100</b>
                    <span>TRADER FIELD</span>
                  </div>
                  <div>
                    <b>7</b>
                    <span>STARTERS</span>
                  </div>
                  <div>
                    <b>1.5×</b>
                    <span>CAPTAIN POINTS</span>
                  </div>
                </div>
              </div>
              <Formation
                compact
                players={players}
                picks={picks}
                captain={captain}
                editable={false}
                change={change}
              />
            </section>
            <section className="format-ribbon">
              {TIERS.map((t) => (
                <Link
                  href="/draft"
                  key={t.id}
                  style={{ "--tier": t.color } as CSSProperties}
                >
                  <span>
                    #{t.min}–{t.max}
                  </span>
                  <b>{t.name}</b>
                  <small>
                    {t.picks} {t.picks === 1 ? "PICK" : "PICKS"}
                  </small>
                  <Arrow />
                </Link>
              ))}
            </section>
            <section className="league-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">THE WEEKLY SCHEDULE</p>
                  <h2>MAKE YOUR PICKS. THEN IT COUNTS.</h2>
                </div>
                <Link href="/rules">
                  Full rules <Arrow />
                </Link>
              </div>
              <div className="steps">
                {[
                  [
                    "01",
                    "The opening draft",
                    "You have 45 minutes to submit your first lineup. Hold 500,000 PFL, pick seven traders and name your captain.",
                  ],
                  [
                    "02",
                    "Clock out. Lineups locked.",
                    "Submit or edit before the deadline. When the clock hits zero, your team locks and the seven-day competition begins.",
                  ],
                  [
                    "03",
                    "Seven days. Every point counts.",
                    "Daily scores build your weekly total. Draft your next team during the final 24 hours; it takes over when the next week begins.",
                  ],
                ].map(([n, t, d]) => (
                  <article key={n}>
                    <span>{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
        {["draft", "team"].includes(page) && (
          <section className="league-section draft-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {page === "draft" ? "THE DRAFT ROOM" : "YOUR WEEKLY LINEUP"}
                </p>
                <h1>
                  {page === "draft" ? (
                    <>
                      DRAFT YOUR
                      <br />
                      <em>STARTING SEVEN.</em>
                    </>
                  ) : (
                    "MY TEAM."
                  )}
                </h1>
                <p>
                  Pick seven traders from Pump.fun’s Top 100. Build your lineup
                  and compete for $PUMP.
                </p>
              </div>
              <div className="lock-clock">
                <small>
                  {!round ? "OPENING DRAFT" : entryOpen ? "DRAFT LOCKS IN" : "LEAGUE CLOCK · UTC"}
                </small>
                <b>{countdown}</b>
                <span>{phase}</span>
              </div>
            </div>
            <div className="draft-layout">
              <div className="draft-market">
                <div
                  className="tier-tabs"
                  id="draft-tier-navigation"
                  role="tablist"
                  aria-label="Draft tiers"
                >
                  {TIERS.map((t, i) => (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={tier === i}
                      onClick={() => setTier(i)}
                      style={{ "--tier": t.color } as CSSProperties}
                    >
                      {t.name}
                      <span>
                        {
                          picks.filter((id) =>
                            players.some(
                              (p) => p.id === id && tierFor(p.rank).id === t.id,
                            ),
                          ).length
                        }
                        /{t.picks}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="draft-toolbar">
                  <input
                    aria-label="Search traders"
                    placeholder="Search traders or wallet…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select
                    aria-label="Sort traders"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="rank">Highest PnL</option>
                    <option value="pnl-low">Lowest PnL</option>
                  </select>
                </div>
                <div className="market-caption">
                  <b>{TIERS[tier].name.toUpperCase()}</b>
                  <span>
                    CHOOSE {TIERS[tier].picks} · RANKS {TIERS[tier].min}–
                    {TIERS[tier].max}
                  </span>
                </div>
                {data.status === "loading" && players.length === 0 ? (
                  <div
                    className="league-skeleton"
                    aria-label="Loading traders"
                  />
                ) : visible.length ? (
                  <div className="trader-list">
                    {visible.map((p) => (
                      <article
                        key={p.id}
                        className={picks.includes(p.id) ? "selected" : ""}
                      >
                        <span className="rank">
                          {p.rank.toString().padStart(2, "0")}
                        </span>
                        <button
                          className="trader-profile"
                          onClick={() => setInspect(p)}
                        >
                          {p.avatar ? (
                            <Image
                              src={p.avatar}
                              width={44}
                              height={44}
                              alt=""
                              unoptimized
                            />
                          ) : (
                            <span className="avatar-initial">
                              {p.name.slice(0, 2)}
                            </span>
                          )}
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.trades === null
                                ? tierFor(p.rank).name
                                : `${p.trades.toLocaleString()} qualifying trades`}
                            </small>
                          </span>
                        </button>
                        <div className="trader-pnl">
                          <b>{money(p.pnlMicros)}</b>
                          <small>30D NET PNL</small>
                        </div>
                        <button
                          className="pick-button"
                          disabled={!editable}
                          aria-pressed={picks.includes(p.id)}
                          onClick={() => select(p)}
                        >
                          {picks.includes(p.id) ? "Picked" : "Draft"}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={
                      players.length
                        ? "No traders match your search"
                        : "Draft board"
                    }
                  >
                    {players.length
                      ? "Try a different name or wallet."
                      : "Your Top 100 player pool appears here."}
                    {!players.length && (
                      <button
                        className="clear-lineup"
                        onClick={() => void refresh()}
                        disabled={refreshing}
                      >
                        {refreshing ? "Refreshing…" : "Refresh players"}
                      </button>
                    )}
                  </Empty>
                )}
                <div className="source-line">
                  {players.length
                    ? `${players.length} traders · ${round ? "Round snapshot" : "Pump monthly snapshot"} · ${new Date(round?.pool_observed_at ?? draftCatalog.capturedAt).toLocaleString()}`
                    : ""}
                  <button onClick={() => void refresh()} disabled={refreshing}>
                    {refreshing ? "Refreshing…" : "Refresh field"}
                  </button>
                </div>
              </div>
              <aside className="lineup-panel">
                <Formation
                  players={players}
                  picks={picks}
                  captain={captain}
                  editable={editable}
                  change={change}
                />
                <div className="lineup-controls">
                  <div className="progress-label">
                    <b>LINEUP COMPLETE</b>
                    <span>{picks.length} / 7</span>
                  </div>
                  <progress value={picks.length} max={7} />
                  <p>
                    {auth.authenticated
                      ? auth.eligible
                        ? "Wallet verified · holder requirement met"
                        : "Hold at least 500,000 PFL to enter."
                      : "Connect and verify your wallet to submit."}
                  </p>
                  {data.roster?.disqualified_at && (
                    <p className="error-text">
                      Disqualified this week:{" "}
                      {data.roster.disqualification_reason}
                    </p>
                  )}
                  <button
                    className="primary-action submit-lineup"
                    onClick={() => void submit()}
                    disabled={
                      !editable || picks.length !== 7 || !captain || busy
                    }
                  >
                    {busy
                      ? "Saving lineup…"
                      : !editable
                        ? !round
                          ? "Build your Week 1 lineup"
                          : "Draft not open"
                        : picks.length !== 7
                          ? "Complete your seven"
                          : !captain
                            ? "Choose your captain"
                            : !round
                              ? "Save draft"
                              : data.roster
                                ? "Save changes"
                                : "Submit lineup"}
                    <Arrow />
                  </button>
                  <button
                    className="clear-lineup"
                    disabled={!editable || !picks.length}
                    onClick={() => change([], "")}
                  >
                    Clear selections
                  </button>
                  {notice && <p role="status">{notice}</p>}
                  <small>
                    Sign-in message only. No token deposit or spending approval.
                  </small>
                </div>
              </aside>
            </div>
          </section>
        )}
        {["home", "leaderboard", "team"].includes(page) && (
          <section className="league-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">THE LEAGUE TABLE</p>
                <h2>
                  {page === "home" ? "LEAGUE STANDINGS." : "LEADERBOARD."}
                </h2>
              </div>
              <div className="board-tabs" aria-label="Leaderboard period">
                {(["daily", "weekly", "season"] as const).map((t) => (
                  <button
                    key={t}
                    aria-pressed={board === t}
                    onClick={() => setBoard(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="leaderboard-table">
              <div className="table-labels">
                <span>RANK / MANAGER</span>
                <span>
                  {board === "season" ? "SEASON POINTS" : "FANTASY POINTS"}
                </span>
                <span>STATUS</span>
              </div>
              {(data.boards?.[board]?.length ?? 0) > 0 ? (
                <div>
                  {board === "season"
                    ? data.boards?.season.map((r) => (
                        <div className="standings-row" key={r.wallet}>
                          <span>
                            <b>#{r.rank}</b> {short(r.wallet)}
                          </span>
                          <strong>{Number(r.points) / 100}</strong>
                          <span>Completed weeks</span>
                        </div>
                      ))
                    : data.boards?.[board].map((r) => (
                        <details
                          key={r.wallet}
                          className={
                            r.wallet === auth.wallet ? "my-standing" : ""
                          }
                        >
                          <summary className="standings-row">
                            <span>
                              <b>{r.rank === null ? "—" : `#${r.rank}`}</b>{" "}
                              {short(r.wallet)}
                              {r.wallet === auth.wallet ? " · YOU" : ""}
                            </span>
                            <strong>
                              {r.points2 === null ? "Pending" : r.points2 / 2}
                            </strong>
                            <span>{r.eligible}</span>
                          </summary>
                          <div className="shared-roster">
                            {r.picks.map((id) => (
                              <span key={id}>
                                {r.captain === id && <Crown />}
                                {players.find((p) => p.id === id)?.name ??
                                  short(id)}
                              </span>
                            ))}
                          </div>
                        </details>
                      ))}
                </div>
              ) : (
                <Empty title="No scores posted yet.">
                  The standings open after the first day’s results are verified.
                </Empty>
              )}
            </div>
            <p className="section-note">
              {data.scoringDays?.length
                ? `${data.scoringDays.length} completed daily intervals · latest close ${new Date(data.scoringDays.at(-1)!.ends_at).toUTCString()}`
                : "Seven daily scores. One weekly result."}{" "}
              <Link href="/rules">How scoring works</Link>
            </p>
          </section>
        )}
        {["home", "rewards"].includes(page) && (
          <section className="league-section rewards-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PLAY FOR {rewardSymbol}</p>
                <h2>
                  {page === "rewards"
                    ? "YOUR REWARDS."
                    : "DAILY PRIZES. SEASON TITLE."}
                </h2>
              </div>
              {page === "rewards" && (
                <span className="status-pill">
                  {data.rewards?.payoutsActive
                    ? "Claims open"
                    : "Claims not open"}
                </span>
              )}
            </div>
            <div className="reward-pools">
              {[
                ["daily", "30", "Daily rewards", "Top 3 · 50 / 30 / 20"],
                [
                  "season",
                  "50",
                  "Season rewards",
                  "Top 10 finishers · full split in the rules",
                ],
                ["champion", "20", "Champion bonus", "Overall season champion"],
              ].map(([id, percent, title, description]) => (
                <article key={id}>
                  <div>
                    <span>{title}</span>
                    <Crown />
                  </div>
                  <b>
                    {percent}
                    <small>%</small>
                  </b>
                  <p>{description}</p>
                  <footer>
                    <span>VERIFIED {rewardSymbol}</span>
                    <strong>
                      {poolAmount(data.rewards, id)}
                    </strong>
                  </footer>
                </article>
              ))}
            </div>
            {page === "rewards" && (
              <>
                <div className="reward-metrics">
                  <div>
                    <span>CONFIRMED CREATOR FEES</span>
                    <b>
                      {data.rewards
                        ? `${formatRewardAmount(data.rewards.fees.received, data.rewards.fees.asset)} ${data.rewards.fees.asset === "PUMP" ? "$PUMP" : "SOL"}`
                        : "—"}
                    </b>
                  </div>
                  <div>
                    <span>YOUR CLAIMABLE REWARDS</span>
                    <b>
                      {data.rewards?.payoutsActive
                        ? "See entitlements"
                        : "Claims not open"}
                    </b>
                  </div>
                </div>
                <h3>Personal rewards</h3>
                {claimNotice && <p role="status">{claimNotice}</p>}
                {data.rewards?.personal.length ? (
                  <div className="ledger-list">
                    {data.rewards.personal.map((r) => (
                      <div key={r.id}>
                        <span>{r.pool}</span>
                        <span>{data.rewards?.asset === "PUMP" ? `${formatRewardAmount(r.amount_raw, "PUMP")} $PUMP` : `${r.amount_raw} base units`}</span>
                        <b>{r.claim_status ?? r.status}</b>
                        {r.status === "available" && !r.claim_status && data.rewards?.payoutsActive && (
                          <button type="button" className="primary-button" disabled={claimBusy || !auth.authenticated} onClick={() => void claimReward(r.id)}>
                            Claim $PUMP
                          </button>
                        )}
                        {r.signature && (
                          <a
                            href={`https://solscan.io/tx/${r.signature}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Transaction <Arrow />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={
                      auth.authenticated
                        ? "No rewards recorded yet."
                        : "Your rewards"
                    }
                  >
                    {auth.authenticated
                      ? "Earned rewards will appear after results and funding are verified."
                      : "Connect your wallet to view pending, available and completed rewards."}
                  </Empty>
                )}
                <h3>{data.rewards?.asset === "PFL" ? "Verified conversions & payouts" : "Verified payouts"}</h3>
                {data.rewards &&
                data.rewards.conversions.length + data.rewards.history.length >
                  0 ? (
                  <div className="ledger-list">
                    {data.rewards.conversions.map((c) => (
                      <div key={c.signature}>
                        <span>{c.pool} conversion</span>
                        <b>{c.status}</b>
                        <a
                          href={`https://solscan.io/tx/${c.signature}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction <Arrow />
                        </a>
                      </div>
                    ))}
                    {data.rewards.history.map((h) => (
                      <div key={h.signature}>
                        <span>
                          {short(h.wallet)} · {h.pool}
                        </span>
                        <b>Confirmed</b>
                        <a
                          href={`https://solscan.io/tx/${h.signature}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction <Arrow />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="quiet-message">
                    No confirmed distributions recorded.
                  </p>
                )}
              </>
            )}
          </section>
        )}
        {page === "rules" && (
          <section className="league-section rules-section">
            <p className="eyebrow">THE PFL PLAYBOOK</p>
            <h1>
              THE RULEBOOK.
              <br />
              <em>BEFORE YOU DRAFT.</em>
            </h1>
            <p className="rules-intro">
              Seven picks. One captain. Know the scoring, the deadline and what
              it takes to qualify.
            </p>
            <div className="rules-grid">
              {[
                [
                  "01",
                  "Your starting seven",
                  "Draft 1 Elite (#1–10), 2 Contenders (#11–30), 2 Challengers (#31–60) and 2 Wildcards (#61–100). Each trader appears once on your roster. Other managers can select the same traders.",
                ],
                [
                  "02",
                  "The weekly calendar",
                  "The opening draft lasts 45 minutes. Scoring starts at draft lock and runs for seven 24-hour intervals. Later rounds in this season open drafting in the final 24 hours of the previous week. The published UTC calendar controls every deadline. The inaugural season has four rounds; later seasons can use different calendars.",
                ],
                [
                  "03",
                  "Choose a captain",
                  "Choose exactly one of your seven traders. Their fantasy points receive a 1.5× multiplier, including negative points. Your captain and all selections lock together.",
                ],
                [
                  "04",
                  "How points work",
                  "Positive daily PnL scores 2 × (P − rank + 1), where P is the number of profitable traders. Losses score −2 × loss rank, ordered from smallest loss. Zero PnL scores zero. Ties share the average occupied rank. Add your seven daily scores, then all seven days for the week.",
                ],
                [
                  "05",
                  "Season standings",
                  "Weekly finishes earn 0–100 percentile points using average ranks for ties. A single participant earns 100. Missed or disqualified weeks earn zero. Season ties break on total weekly fantasy points, then best weekly finish; any remaining ties share applicable prizes.",
                ],
                [
                  "06",
                  "Holder eligibility",
                  "Hold at least 500,000 PFL when submitting and throughout the weekly competition. Falling below that threshold disqualifies that week and forfeits its pending daily rewards. Earlier completed weeks remain valid. Eligibility is checked again at season settlement.",
                ],
                [
                  "07",
                  "Fees & rewards",
                  "30% of confirmed creator fees funds daily rewards; 50% funds season rewards; 20% funds the champion bonus. Daily top three shares: 50/30/20. Season top ten shares: 30/20/15, then 5% each. Tied prize positions are shared, with integer dust and unoccupied prizes retained.",
                ],
                [
                  "08",
                  "Verified performance",
                  "The previous 30 days of net PnL determine each trader’s draft tier. Only trading during the competition earns points. Deposits, withdrawals and transfers do not count. Results are finalized after performance and holder eligibility are verified.",
                ],
                [
                  "09",
                  "Reward settlement",
                  "Prize pools use $PUMP collected from confirmed creator fees. Track earned rewards, claim availability and completed payouts in Rewards. A prize is available to claim only after results and funding are confirmed.",
                ],
              ].map(([n, t, d]) => (
                <article key={n}>
                  <span>{n}</span>
                  <div>
                    <h2>{t}</h2>
                    <p>{d}</p>
                  </div>
                </article>
              ))}
            </div>
            <Link className="primary-action" href="/draft">
              Enter the draft room <Arrow />
            </Link>
            <article id="sixth-man" className="sixth-man-scouting">
              <p className="eyebrow">SEASON 2 SCOUTING REPORT</p>
              <h2>6th Man: Create a Player</h2>
              <p>Stop watching. Get drafted. Link your Pump.fun player and burn 500,000 PFL once to register for future seasons. The community-player feature is planned for Season 2. This season keeps Starting Seven.</p>
            </article>
          </section>
        )}
        {page === "champion" && (
          <section className="league-section champion-screen">
            <Crest />
            <p className="eyebrow">PFL SEASON CHAMPIONSHIP</p>
            <h1>
              {data.champions?.length
                ? "SEASON CHAMPION."
                : "THE SEASON TITLE."}
            </h1>
            {data.champions?.length ? (
              data.champions.map((c) => (
                <article key={c.wallet}>
                  <Crown />
                  <h2>{short(c.wallet)}</h2>
                  <p>
                    {Number(c.points) / 100} season points ·{" "}
                    {Number(c.fantasy_points) / 2} fantasy points
                  </p>
                </article>
              ))
            ) : (
              <p>
                The season champion appears after all weekly results are
                finalized.
              </p>
            )}
            <Link href="/leaderboard">
              View season standings <Arrow />
            </Link>
          </section>
        )}
      </main>
      {page === "home" && (
        <section className="draft-callout">
          <div className="draft-callout-mark">
            <Crest />
          </div>
          <div>
            <p className="eyebrow">PUMP FANTASY LEAGUE</p>
            <h2>YOU MAKE THE PICKS.</h2>
            <p>Seven traders. One captain. A new lineup every week.</p>
          </div>
          <Link href="/draft" className="primary-action">
            ENTER THE DRAFT <Arrow />
          </Link>
        </section>
      )}
      <footer className="pfl-footer">
        <Link className="pfl-brand" href="/">
          <Crest />
          <span>
            PUMP FANTASY
            <br />
            <b>LEAGUE</b>
          </span>
        </Link>
        <p>Fantasy sports for Pump.fun traders.</p>
        <Link href="/rules">Rules</Link>
        <Link href="/rewards">Rewards</Link>
        <Link href="/champion">Championship</Link>
        <a
          href="https://x.com/PFLeague_fun"
          target="_blank"
          rel="noopener noreferrer"
        >
          <XIcon /> @PFLeague_fun
        </a>
        <a
          className="footer-market-link"
          href={dexUrl}
          target="_blank"
          rel="noreferrer"
        >
          Dexscreener <Arrow />
        </a>
      </footer>
      {inspect && (
        <dialog
          ref={traderDialog}
          className="inspect-overlay"
          aria-label={`${inspect.name} performance`}
          onCancel={() => setInspect(null)}
        >
          <button
            className="inspect-scrim"
            aria-label="Close trader details"
            onClick={() => setInspect(null)}
          />
          <section
            aria-label={`${inspect.name} performance`}
            className="trader-dialog"
          >
            <button
              className="dialog-close"
              onClick={() => setInspect(null)}
              aria-label="Close trader details"
            >
              ×
            </button>
            <span className="eyebrow">
              #{inspect.rank} · {tierFor(inspect.rank).name}
            </span>
            <h2>{inspect.name}</h2>
            <dl>
              <div>
                <dt>30-day net PnL</dt>
                <dd>{money(inspect.pnlMicros)}</dd>
              </div>
              <div>
                <dt>30-day ROI</dt>
                <dd>
                  {inspect.roiBps === null
                    ? "Not available"
                    : `${inspect.roiBps / 100}%`}
                </dd>
              </div>
              <div>
                <dt>Qualifying trades</dt>
                <dd>
                  {inspect.trades === null
                    ? "Not supplied by source"
                    : inspect.trades}
                </dd>
              </div>
            </dl>
            <a href={inspect.sourceUrl} target="_blank" rel="noreferrer">
              Inspect verified source <Arrow />
            </a>
            <p>
              Historical performance sets draft rank. Your weekly score starts
              at draft lock.
            </p>
            <button
              className="primary-action"
              disabled={!editable}
              onClick={() => {
                select(inspect);
                setInspect(null);
              }}
            >
              {picks.includes(inspect.id)
                ? "Remove from lineup"
                : "Add to lineup"}
            </button>
          </section>
        </dialog>
      )}
    </div>
  );
}
