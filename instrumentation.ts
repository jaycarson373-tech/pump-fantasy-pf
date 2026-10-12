export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.RAILWAY_SERVICE_ID) return;
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
