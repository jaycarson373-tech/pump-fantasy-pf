export async function register() {
  // Next removes this branch from the Edge instrumentation bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.RAILWAY_SERVICE_ID) return;
    if (process.env.PF_LEGACY_COMPETITION !== "true") {
      if (process.env.PF_LEAGUE_WORKER_ENABLED !== "true") return;
      const {tickLeague}=await import("./lib/server/league/service");
      const state=globalThis as typeof globalThis & {__pflSevenWorker?:ReturnType<typeof setInterval>};
      if(!state.__pflSevenWorker){const run=()=>{void tickLeague().catch(()=>console.error("PFL worker unavailable; inspect persisted job state"));};run();state.__pflSevenWorker=setInterval(run,60_000);}
      return;
    }
    const processState = globalThis as typeof globalThis & { __pumpFantasyTick?: ReturnType<typeof setInterval> };
    if (processState.__pumpFantasyTick) return;
    const { tickSeason } = await import("./lib/server/season-results");
    const run = () => {
      void tickSeason().then((result) => {
        if (result.acquired && result.value && result.value.action !== "waiting" && result.value.action !== "idle") console.info("Pump Fantasy season clock:", result.value);
      }).catch((error: unknown) => console.error("Pump Fantasy season clock failed:", error));
    };
    run();
    processState.__pumpFantasyTick = setInterval(run, 5 * 60 * 1000);
  }
}
