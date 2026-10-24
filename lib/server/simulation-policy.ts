/** A successful RPC response explicitly reports err:null; absence is not success. */
export function requireSuccessfulSimulation(result: unknown): void {
  if (!result || typeof result !== "object" || !("value" in result))
    throw new Error("Simulation evidence is incomplete. Nothing was sent.");
  const value = result.value;
  if (!value || typeof value !== "object" || !("err" in value) || value.err !== null)
    throw new Error("Transaction simulation failed or returned incomplete evidence. Nothing was sent.");
}
