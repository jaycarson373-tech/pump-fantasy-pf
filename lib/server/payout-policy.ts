// An unknown transaction can still represent a paid award. Its cap reservation
// survives RPC errors and process restarts; only chain reconciliation settles it.
export const RESERVED_AWARD_STATUSES = ["paid", "payment_prepared", "payment_unknown", "payment_failed"] as const;
export function explicitPayoutCap(value: string | undefined) {
  return value && /^[1-9]\d*$/.test(value) && BigInt(value) <= 1_000_000_000_000n ? BigInt(value) : null;
}
export function finalizedPayoutDisposition(status: { confirmationStatus: string | null; err: unknown } | null) {
  if (!status) return "absent" as const;
  if (status.confirmationStatus !== "finalized") return "pending" as const;
  return status.err === null ? "paid" as const : "failed" as const;
}
export function seasonAwardFits(cap: bigint, reserved: bigint, candidate: bigint) {
  return cap > 0n && reserved >= 0n && candidate > 0n && reserved + candidate <= cap;
}
