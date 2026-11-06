import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SITE = 'https://www.pfleague.fun';
const TARGET = {
  project: 'c2b1929e-3fd4-46b7-98ca-f248cb594774',
  environment: '0607b9e4-bd46-4278-9ab6-fac525df8dc5',
  service: '94656ee0-803b-45d2-990c-5744301c8295',
};
const U64_MAX = (1n << 64n) - 1n;
const POLL_INTERVAL_MS = 3000;
const DEPLOY_WAIT_MS = 180000;
const DRAFT_NOTICE_MS = 120000;

export function pumpRaw(value) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value ?? '')) throw Error('Supply a positive PUMP amount with at most six decimals.');
  const [whole, fraction = ''] = value.split('.');
  const raw = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (raw <= 0n || raw > U64_MAX) throw Error('PUMP amount is outside token limits; choose a smaller positive cap.');
  return raw.toString();
}
function futureIso(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value ?? '') || Date.parse(value) <= Date.now() || !Number.isFinite(Date.parse(value)))
    throw Error('Supply a future UTC timestamp, for example YYYY-MM-DDTHH:MM:SSZ.');
  return new Date(value).toISOString();
}
function draftRequest(args) {
  const [, id, number, at] = args;
  if (![3,4].includes(args.length) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)))
    throw Error('Use start-draft <unique-season-id> <season-number> [future-UTC-time].');
  return { action: 'create-season', id, title: `PFL Season ${number}`, number: Number(number),
    openingDraftAt: futureIso(at ?? new Date(Date.now() + DRAFT_NOTICE_MS).toISOString()), weeks: 4 };
}
export function operation(args) {
  const [command, first, second, third] = args;
  switch (command) {
    case 'status':
      if (args.length !== 1) throw Error('Use status without arguments.');
      return { command };
    case 'league-on':
      if (args.length !== 1) throw Error('Use league-on without arguments.');
      return { command, values: { PF_LEGACY_COMPETITION: 'false', PF_LEAGUE_WORKER_ENABLED: 'true', PF_REWARD_ASSET: 'PUMP' } };
    case 'start-draft': return { command, body: draftRequest(args) };
    case 'payouts-on': {
      if (args.length !== 4) throw Error('Use payouts-on <max-PUMP-per-award> <max-PUMP-per-season> <future-UTC-deadline>.');
      const award = pumpRaw(first), season = pumpRaw(second);
      if (BigInt(award) > BigInt(season)) throw Error('The per-award cap must not exceed the season cap.');
      return { command, values: {
        PF_LEGACY_COMPETITION: 'false', PF_LEAGUE_WORKER_ENABLED: 'true',
        PF_FEE_COLLECTION_ENABLED: 'true', PF_AUTO_PAYOUT_ENABLED: 'true',
        PF_REWARD_ASSET: 'PUMP', PF_PAYOUT_NETWORK: 'mainnet-beta',
        PF_AUTO_PAYOUT_MAX_AWARD_RAW: award, PF_AUTO_PAYOUT_MAX_SEASON_RAW: season,
        PF_AUTO_PAYOUT_RUN_UNTIL: futureIso(third),
      } };
    }
    case 'payouts-off':
      if (args.length !== 1) throw Error('Use payouts-off without arguments.');
      return { command, values: { PF_AUTO_PAYOUT_ENABLED: 'false', PF_AUTO_PAYOUT_RUN_UNTIL: '1970-01-01T00:00:00.000Z' } };
    default: throw Error('Use status, league-on, start-draft, payouts-on or payouts-off. See docs/STARTING_SEVEN.md.');
  }
}
async function admin(body) {
  const secret = process.env.PF_DATA_INGEST_SECRET;
  if (!secret) throw Error('Load PF_DATA_INGEST_SECRET securely into this process, then retry. Never paste it into command arguments.');
  const response = await fetch(`${SITE}/api/league/admin`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  let result;
  try { result = await response.json(); } catch { throw Error(`PFL admin API returned HTTP ${response.status} without JSON; restore the latest backend first.`); }
  if (!response.ok) throw Error(`PFL admin request failed (HTTP ${response.status}); inspect the deployed backend and season state.`);
  return result;
}
export function assertConfigured(status, payouts, requireWorker = true) {
  if (!status?.settings || !status.present) throw Error('Deploy the current control-status endpoint before starting live effects.');
  const required = ['DATABASE_URL', 'PF_SESSION_SECRET', 'SOLANA_RPC_URL', 'PF_RANKINGS_URL', 'PF_PNL_URL', 'PF_ELIGIBILITY_URL'];
  if (payouts) required.push('PF_PAYOUT_SIGNER_KEYPAIR_JSON', 'PF_CREATOR_WALLET_ADDRESS', 'PF_PRIZE_WALLET_ADDRESS');
  const missing = required.filter(name => status.present[name] !== true);
  if (!status.mintConfigured) missing.push('FANTASY_MINT_ADDRESS');
  if (missing.length) throw Error(`Configure ${missing.join(', ')} before starting this operation.`);
  assertStartSettings(status.settings, payouts, requireWorker);
}
function assertStartSettings(settings, payouts, requireWorker) {
  if (payouts) {
    if (!Number.isFinite(Date.parse(settings.PF_LEAGUE_FEE_CUTOVER ?? ''))) throw Error('Configure the reviewed PF_LEAGUE_FEE_CUTOVER before enabling fee allocation.');
    if (settings.PF_CREATOR_WALLET_DEDICATED !== 'true') throw Error('Verify and configure the dedicated creator treasury before enabling payouts.');
    return;
  }
  if (!requireWorker) return;
  if (settings.PF_REWARD_ASSET !== 'PUMP') throw Error('Run league-on to persist PUMP rewards before creating an immutable season.');
  if (settings.PF_LEAGUE_WORKER_ENABLED !== 'true') throw Error('Enable the league worker before opening the draft.');
}

function saveVariables(values) {
  const pairs = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  // Railway updates persisted configuration and triggers its normal redeployment.
  // No variable-list command is used: it would retrieve unrelated signing secrets.
  const result = spawnSync('railway', ['variable', 'set', ...pairs, '--project', TARGET.project,
    '--environment', TARGET.environment, '--service', TARGET.service], { stdio: 'pipe', encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error('Railway configuration update failed. Check CLI login/service access; live state is not confirmed.');
}
async function waitForSettings(values) {
  const deadline = Date.now() + DEPLOY_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const status = await admin({ action: 'status' });
      if (Object.entries(values).every(([name, value]) => status.settings?.[name] === value)) return status;
    } catch { /* The old deployment can be unavailable during replacement. */ }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw Error('Settings were submitted but the live process did not confirm them within three minutes. Treat the previous state as active until checked.');
}
async function main() {
  const op = operation(process.argv.slice(2));
  console.log(`PFL ${SITE}\nRailway project ${TARGET.project}; environment ${TARGET.environment}; web ${TARGET.service}`);
  if (op.command === 'status') {
    console.log(JSON.stringify(await admin({ action: 'status' }), null, 2));
    return;
  }
  if (op.command === 'start-draft') {
    assertConfigured(await admin({ action: 'status' }), false);
    const result = await admin(op.body);
    console.log(JSON.stringify(result, null, 2));
    console.log('Draft scheduled. It locks after 45 minutes; scoring follows automatically. Verify the published pool before inviting entries.');
    return;
  }
  if (!process.env.PF_DATA_INGEST_SECRET) throw Error('Load PF_DATA_INGEST_SECRET for live verification before changing settings.');
  if (op.command === 'league-on') assertConfigured(await admin({ action: 'status' }), false, false);
  if (op.command === 'payouts-on') assertConfigured(await admin({ action: 'status' }), true);
  saveVariables(op.values);
  const status = await waitForSettings(op.values);
  console.log(JSON.stringify(status, null, 2));
  const messages = {
    'league-on': 'League worker ON confirmed. Payout and collection switches are unchanged; start-draft schedules the entry window.',
    'payouts-off': 'Payouts OFF confirmed by the running service. New transfers/rebroadcasts stop; prior submissions may still finalize. Scoring and fee collection settings are unchanged.',
    'payouts-on': 'Payout settings ON confirmed. Collection and winner claims still enforce mint, funding, proof, caps and deadline. ON is not a completed payout.',
  };
  console.log(messages[op.command]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
