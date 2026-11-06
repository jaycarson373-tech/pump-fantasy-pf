/** Authenticated operator status: never load a signer or return secret values. */
export function leagueControlStatus(env: NodeJS.ProcessEnv = process.env) {
  const names = ["PF_LEGACY_COMPETITION", "PF_LEAGUE_WORKER_ENABLED", "PF_FEE_COLLECTION_ENABLED",
    "PF_AUTO_PAYOUT_ENABLED", "PF_REWARD_ASSET", "PF_PAYOUT_NETWORK", "PF_CREATOR_WALLET_DEDICATED",
    "PF_AUTO_PAYOUT_MAX_AWARD_RAW", "PF_AUTO_PAYOUT_MAX_SEASON_RAW", "PF_AUTO_PAYOUT_RUN_UNTIL",
    "PF_LEAGUE_FEE_CUTOVER"];
  const required = ["DATABASE_URL", "PF_SESSION_SECRET", "SOLANA_RPC_URL", "PF_DATA_INGEST_SECRET",
    "PF_RANKINGS_URL", "PF_PNL_URL", "PF_ELIGIBILITY_URL", "PF_PAYOUT_SIGNER_KEYPAIR_JSON",
    "PF_CREATOR_WALLET_ADDRESS", "PF_PRIZE_WALLET_ADDRESS"];
  return {
    revision: env.RAILWAY_GIT_COMMIT_SHA ?? null,
    settings: Object.fromEntries(names.map(name => [name, env[name] ?? null])),
    present: Object.fromEntries(required.map(name => [name, Object.hasOwn(env, name)])),
    mintConfigured: Boolean(env.FANTASY_MINT_ADDRESS || env.PF_MINT_ADDRESS),
    note: "Presence and switches are configuration evidence, not funded execution proof.",
  };
}
