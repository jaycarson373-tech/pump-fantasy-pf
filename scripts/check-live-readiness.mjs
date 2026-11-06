// Public Starting Seven evidence only. No credentials, signing or season mutation.
const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.pfleague.fun";
let baseUrl;
try {
  baseUrl = new URL(configuredUrl).origin;
} catch {
  console.error("NEXT_PUBLIC_SITE_URL must be a valid absolute URL.");
  process.exit(2);
}
async function get(path) {
  try {
    const response = await fetch(new URL(path, baseUrl), {
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* HTML is expected for public pages. */ }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}
let blocked = false;
function report(label, passed, detail = "") {
  if (!passed) blocked = true;
  console.log(`${passed ? "PASS" : "BLOCK"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
console.log(`Starting Seven public preflight · ${baseUrl}`);
const [site, draft, response] = await Promise.all([get("/"), get("/draft"), get("/api/league")]);
report("Public site responds", site.status === 200, `HTTP ${site.status}`);
report("Draft room responds", draft.status === 200, `HTTP ${draft.status}`);
const league = response.body;
const available = response.status === 200 && league && league.status !== "unavailable";
report("Starting Seven API", available, `HTTP ${response.status}`);
report("Server season and round", Boolean(available && league.season && league.round));
const players = Array.isArray(league?.players) ? league.players : [];
report("Published competition Top 100", players.length === 100 && new Set(players.map(p => p.id)).size === 100);
const rewards = league?.rewards;
report("Actual PUMP reward units", rewards?.asset === "PUMP" && rewards?.tokenDecimals === 6 && rewards?.fees?.asset === "PUMP");
report("Claims enabled", rewards?.payoutsActive === true);
report("Finalized payout evidence", Array.isArray(rewards?.history) && rewards.history.length > 0);
console.log(blocked
  ? "NOT READY: public evidence is incomplete. No season or transaction was started."
  : "PUBLIC EVIDENCE PRESENT: independently verify funded receipts and wallet walkthrough before release.");
process.exitCode = blocked ? 1 : 0;
