/** Public counts use persisted entries and confirmed reward-token claims, never browser clicks. */
export type DraftActivity = {
  id: string;
  wallet: string;
  week: number;
  submittedAt: string;
};
export type LeagueActivityData = {
  status: "ready";
  serverTime: string;
  tokenMint: string;
  tokenDecimals: number | null;
  totalEntrants: string;
  totalEntries: string;
  weeklyEntries: string;
  paidRaw: string | null;
  events: DraftActivity[];
};
export const ACTIVITY_SQL = `
with entries as (
 select p.round_id,p.wallet,p.created_at,r.week,r.opens_at,r.ends_at
 from pfl_rosters p join pfl_rounds r on r.id=p.round_id
 join pfl_seasons s on s.id=r.season_id where s.mint=$1
), current_round as (
 select r.id from pfl_rounds r join pfl_seasons s on s.id=r.season_id
 where s.mint=$1 and s.status in ('scheduled','active')
 and r.opens_at<=statement_timestamp() and r.ends_at>statement_timestamp()
 order by r.opens_at desc limit 1
), paid as (
 select coalesce(sum(e.amount_raw),0)::text amount
 from pfl_claims c join pfl_entitlements e on e.id=c.entitlement_id
 join pfl_seasons s on s.id=e.season_id
 where s.mint=$1 and c.status='confirmed' and c.confirmed_slot is not null
 and c.signature is not null and e.status='claimed' and c.reward_mint=$2 and c.reward_decimals is not null
)
select statement_timestamp()::text as "serverTime",
 (select count(distinct wallet)::text from entries) as "totalEntrants",
 (select count(*)::text from entries) as "totalEntries",
 (select count(*)::text from entries where round_id=(select id from current_round)) as "weeklyEntries",
 (select amount from paid) as "paidRaw",
 coalesce((select jsonb_agg(jsonb_build_object(
   'id',round_id||':'||wallet,'wallet',wallet,'week',week,'submittedAt',created_at
 ) order by created_at,round_id,wallet) from (
   select * from entries where created_at>statement_timestamp()-interval '5 minutes'
   order by created_at desc,round_id,wallet limit 200
 ) recent),'[]'::jsonb) as events
`;
export function freshDraftEvents(
  events: DraftActivity[],
  seen: Set<string>,
  after: number,
  now: number,
) {
  return events
    .filter((event) => {
      const time = Date.parse(event.submittedAt);
      return (
        !seen.has(event.id) &&
        time > after &&
        time <= now &&
        now - time < 120000
      );
    })
    .sort(
      (a, b) =>
        Date.parse(a.submittedAt) - Date.parse(b.submittedAt) ||
        a.id.localeCompare(b.id),
    );
}
export function formatPaid(raw: string, decimals: number | null) {
  if (!/^\d+$/.test(raw)) return "—";
  if (raw === "0") return "0";
  if (
    decimals === null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  )
    return "—";
  const units = BigInt(raw),
    base = 10n ** BigInt(decimals);
  const fraction = (units % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, 4)
    .replace(/0+$/, "");
  const whole = (units / base).toLocaleString("en-US");
  return units < base / 10000n
    ? "<0.0001"
    : whole + (fraction ? "." + fraction : "");
}
