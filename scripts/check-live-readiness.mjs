const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.pumpfunfantasy.xyz";
const secret = process.env.PF_DATA_INGEST_SECRET;

let baseUrl;
try {
  baseUrl = new URL(configuredUrl).origin;
} catch {
  console.error("NEXT_PUBLIC_SITE_URL must be a valid absolute URL.");
  process.exit(2);
}

async function get(path, headers = {}) {
  try {
    const response = await fetch(new URL(path, baseUrl), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: null, error: error instanceof Error ? error.message : "Request failed" };
  }
}

function report(label, passed, detail) {
  console.log(`${passed ? "PASS" : "BLOCK"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log(`Pump Fantasy launch preflight · ${baseUrl}`);
const [site, health, players, entry, standings] = await Promise.all([
  get("/"),
  get("/api/health"),
  get("/api/players"),
  get("/api/entry"),
  get("/api/standings"),
]);

const siteOk = site.status === 200;
report("Public site responds", siteOk, site.error || `HTTP ${site.status}`);

const healthBody = health.body;
const serviceOk = health.status === 200 && healthBody?.service === "pump-fantasy";
report("Railway health endpoint", serviceOk, health.error || `HTTP ${health.status}`);
for (const [label, key] of [
  ["Backend configuration", "backendConfigured"],
  ["Database and migrations", "databaseConfigured"],
  ["Wallet and token checks", "walletChecksConfigured"],
  ["FANTASY mint initialized", "tokenMintInitialized"],
  ["Season configured", "activeSeasonConfigured"],
  ["Prize amount and wallet configured", "payoutConfigured"],
]) {
  report(label, healthBody?.[key] === true);
}

const board = players.body;
const rosterOk = players.status === 200 && board?.live === true && Array.isArray(board.players) && board.players.length === 50 && board.players.every((player, index) => player.rank === index + 1 && typeof player.wallet === "string" && Number.isFinite(player.pnl_usd)) && new Set(board.players.map((player) => player.wallet)).size === 50;
report("Live Pump.fun top-50 roster", rosterOk, board?.source || `HTTP ${players.status}`);

const entryBody = entry.body;
const entryServiceOk = entry.status === 200 && entryBody?.configured === true && entryBody?.seasonConfigured === true && ["scheduled", "draft", "live", "complete"].includes(entryBody?.phase);
report("Entry API and season schedule", entryServiceOk, entryBody?.phase || `HTTP ${entry.status}`);
if (entryServiceOk) report("Draft currently accepting entries", entryBody.phase === "draft", entryBody.phase === "draft" ? "open" : `season is ${entryBody.phase}`);

const standingsBody = standings.body;
const standingsOk = standings.status === 200 && standingsBody?.configured === true && standingsBody?.phase !== "inactive";
report("Scoring and season status API", standingsOk, standingsBody?.phase || `HTTP ${standings.status}`);

let preflightReady = false;
if (secret) {
  const preflight = await get("/api/admin/season/preflight", { authorization: `Bearer ${secret}` });
  preflightReady = preflight.status === 200 && preflight.body?.ready === true;
  report("Protected launch preflight", preflightReady, preflight.error || `HTTP ${preflight.status}`);
  if (Array.isArray(preflight.body?.blockers)) {
    for (const blocker of preflight.body.blockers) console.log(`  • ${blocker}`);
  }
} else {
  report("Protected launch preflight", false, "set PF_DATA_INGEST_SECRET in this shell to check prize funding and start readiness");
}

const ready = siteOk && serviceOk && healthBody?.backendConfigured === true && healthBody?.walletChecksConfigured === true && healthBody?.tokenMintInitialized === true && rosterOk && entryServiceOk && standingsOk && preflightReady;
console.log(ready ? "\nREADY: preflight passed. The season has not been started by this check." : "\nNOT READY: resolve the blockers above. This check is read-only; it never opens a season or sends a transaction.");
process.exitCode = ready ? 0 : 1;
