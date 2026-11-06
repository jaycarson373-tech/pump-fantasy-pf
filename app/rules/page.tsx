import Link from 'next/link';
import type { Metadata } from 'next';
import '../launch-polish.css';

export const metadata: Metadata = {
  title: 'League rules | Pump Fantasy League',
  description: 'The PFL format: draft five traders, follow their PnL and compete for daily and season rewards.',
};

export default function Rules() {
  return <main className="rules-page">
    <Link href="/">Pump Fantasy League <span> / Rules</span></Link>
    <p className="rules-kicker">SEASON 1 FORMAT · $PFL</p>
    <h1>Five picks.<br />One league.</h1>
    <p className="rules-lead">Build your lineup from Pump.fun’s top 50 traders. Your squad competes on their combined PnL change.</p>
    <div className="rules-overview" aria-label="Season format">
      <div><b>5 traders</b><span>One from each band</span></div>
      <div><b>60 min</b><span>To submit your squad</span></div>
      <div><b>48 hours</b><span>Of season scoring</span></div>
    </div>
    <section>
      <h2>01 — Build your squad</h2>
      <p>Hold at least <strong>500,000 PFL</strong>, connect your wallet and sign in. Pick one trader from each rank band: 1–10, 11–20, 21–30, 31–40 and 41–50. One wallet, one lineup.</p>
      <p>Submit before the 60-minute draft closes. You can edit and resubmit while it is open. Your picks count only after the server confirms them.</p>
      <details><summary>Wallet sign-in and roster locks</summary><p>Sign-in uses a wallet message; it does not transfer tokens. The server fixes the top-50 roster when the season opens. Local picks are not entered until your submission is confirmed. Changes must be resubmitted before the draft deadline.</p></details>
    </section>
    <section>
      <h2>02 — Follow the PnL</h2>
      <p>Each trader scores the change in their reported one-month PnL between the scoring snapshots. Add the changes for all five picks. The highest combined score wins.</p>
      <p>Daily rounds use their own starting snapshots. The season score measures the full 48 hours. The historical PnL displayed on a trader card is their starting reference, not points already earned.</p>
      <details><summary>Ties, negative scores and missing data</summary><p>Negative changes count. Ties are resolved by wallet address in ascending order. A missing trader or incomplete snapshot holds the result for review; it does not become a zero or an invented score.</p></details>
    </section>
    <section>
      <h2>03 — Compete for rewards</h2>
      <p>Confirmed creator fees fund three separate allocations:</p>
      <div className="rules-overview" aria-label="Creator fee allocation">
        <div><b>30%</b><span>Daily payouts</span></div>
        <div><b>50%</b><span>Season leaderboard</span></div>
        <div><b>20%</b><span>Championship bonus</span></div>
      </div>
      <p>The top squad at each daily cutoff wins that day’s pool. The highest total PnL change wins the season pool. A reward is marked paid only after the exact SOL transfer is finalized.</p>
      <details><summary>Pool cutoffs and championship reserves</summary><p>Only finalized creator-fee receipts enter the pools. The daily pool freezes at its cutoff; the season pool freezes at the 48-hour close. Later receipts enter the next pool. If there are no eligible entries, the allocation carries forward. Missing scoring data holds the allocation for review.</p><p>Daily and season payouts cannot spend championship reserves. Championship bonuses require separate published rules before release. Rounding remainders stay in the championship reserve. Rewards depend on available funds; there is no fixed prize or guaranteed yield.</p></details>
    </section>
    <section>
      <h2>Before you enter</h2>
      <p>The draft room shows the authoritative season status and deadlines. Entries open after the token, holder checks, roster, schedule and reward configuration pass the launch checks.</p>
      <p>Future seasons may use different formats. Their timing and rules will be published before entry opens.</p>
      <details><summary>Data and independence</summary><p>Pump Fantasy League is independent of Pump.fun. External PnL data can be delayed or revised, and token prices can fall.</p></details>
    </section>
    <Link className="rules-return" href="/#draft">Back to the draft room</Link>
  </main>;
}
