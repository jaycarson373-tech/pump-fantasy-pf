import {
  AccountRole,
  address,
  blockhash,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getTransactionEncoder,
  getTransactionDecoder,
  getBase58Decoder,
} from "@solana/kit";

import { MEMO_PROGRAM } from "./types";
import {
  assertWalletEditsAllowed,
  computeLimitData,
  computePriceData,
  WALLET_POLICY,
} from "./wallet-policy";
import type { BurnIntent, PreparedBurn } from "./types";

// SPL Token's BurnChecked layout: tag u8, amount u64 little-endian, decimals u8.
const BURN_CHECKED = 15;
const BURN_BYTES = 10;
const AMOUNT_OFFSET = 1;
const DECIMALS_OFFSET = 9;
export function buildBurnTransaction(
  intent: BurnIntent,
  hash: string,
  height: number,
): PreparedBurn {
  const data = Buffer.alloc(BURN_BYTES);
  data[0] = BURN_CHECKED;
  data.writeBigUInt64LE(BigInt(intent.amount), AMOUNT_OFFSET);
  data[DECIMALS_OFFSET] = intent.decimals;
  const message = setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: blockhash(hash), lastValidBlockHeight: BigInt(height) },
    setTransactionMessageFeePayer(
      address(intent.wallet),
      createTransactionMessage({ version: "legacy" }),
    ),
  );
  const complete = appendTransactionMessageInstructions(
    [
      {
        programAddress: address(WALLET_POLICY.COMPUTE_BUDGET),
        data: computeLimitData(),
      },
      {
        programAddress: address(WALLET_POLICY.COMPUTE_BUDGET),
        data: computePriceData(),
      },
      {
        programAddress: address(intent.tokenProgram),
        data,
        accounts: [
          { address: address(intent.source), role: AccountRole.WRITABLE },
          { address: address(intent.mint), role: AccountRole.WRITABLE },
          {
            address: address(intent.wallet),
            role: AccountRole.READONLY_SIGNER,
          },
        ],
      },
      {
        programAddress: address(MEMO_PROGRAM),
        data: new TextEncoder().encode(intent.memo),
      },
    ],
    message,
  );
  const wire = getTransactionEncoder().encode(compileTransaction(complete));
  return {
    transaction: Buffer.from(wire).toString("base64"),
    blockhash: hash,
    lastValidBlockHeight: height,
  };
}
const MAX_WIRE_BASE64 = 1700;
const SIGNATURE_BYTES = 64;
export function signedBurn(
  prepared: PreparedBurn,
  wire: unknown,
  wallet: string,
) {
  if (
    typeof wire !== "string" ||
    wire.length > MAX_WIRE_BASE64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(wire)
  )
    throw new Error(
      "Invalid signed transaction. Sign the prepared quote again.",
    );
  try {
    const decode = getTransactionDecoder();
    const expected = decode.decode(Buffer.from(prepared.transaction, "base64"));
    const actual = decode.decode(Buffer.from(wire, "base64"));
    const signature = actual.signatures[address(wallet)];
    assertWalletEditsAllowed(
      Buffer.from(expected.messageBytes),
      Buffer.from(actual.messageBytes),
    );
    if (
      Object.keys(actual.signatures).length !== 1 ||
      !signature ||
      signature.length !== SIGNATURE_BYTES ||
      signature.every((byte) => byte === 0)
    )
      throw new Error("signature");
    return { wire, signature: getBase58Decoder().decode(signature) };
  } catch {
    throw new Error(
      "Wallet changed the prepared transaction or returned no signature. Reopen the original quote.",
    );
  }
}
