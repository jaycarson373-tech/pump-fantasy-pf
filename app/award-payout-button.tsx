"use client";

import { useState } from "react";
import { AccountRole, address, appendTransactionMessageInstruction, compileTransaction, createTransactionMessage, getTransactionEncoder, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from "@solana/kit";
import { useSignAndSendTransaction } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import type { UiWalletAccount } from "@wallet-standard/ui";
import { solanaClient } from "./solana-client";

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
type Props = { awardId: string; winner: string | null; lamports: string; status: string; prizeWallet: string | null; onPaid: (awardId: string, signature: string) => void };

function encodeBase58(bytes: Uint8Array) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    encoded = BASE58_ALPHABET[digit] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function PayoutAction({ account, awardId, winner, lamports, onPaid }: Props & { account: UiWalletAccount; winner: string }) {
  const signAndSend = useSignAndSendTransaction(account, "solana:mainnet");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function payAward() {
    setBusy(true);
    setMessage("");
    try {
      const recentBlockhash = await solanaClient.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      const source = address(account.address);
      const destination = address(winner);
      const data = new Uint8Array(12);
      const view = new DataView(data.buffer);
      view.setUint32(0, 2, true);
      view.setBigUint64(4, BigInt(lamports), true);
      const instruction = {
        programAddress: SYSTEM_PROGRAM,
        accounts: [
          { address: source, role: AccountRole.WRITABLE_SIGNER },
          { address: destination, role: AccountRole.WRITABLE },
        ],
        data,
      };
      const transactionMessage = appendTransactionMessageInstruction(
        instruction,
        setTransactionMessageLifetimeUsingBlockhash(
          recentBlockhash.value,
          setTransactionMessageFeePayer(source, createTransactionMessage({ version: 0 })),
        ),
      );
      const wireTransaction = getTransactionEncoder().encode(compileTransaction(transactionMessage));
      const { signature } = await signAndSend({ transaction: new Uint8Array(wireTransaction) });
      const signatureText = encodeBase58(signature);
      const response = await fetch("/api/awards/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ awardId, signature: signatureText }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transfer sent, but award verification is still pending.");
      onPaid(awardId, signatureText);
      setMessage("Payment confirmed on Solana.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment failed.");
    } finally {
      setBusy(false);
    }
  }

  const sol = (Number(lamports) / 1_000_000_000).toFixed(4);
  return <div className="award-payout-control"><button className="award-pay-button" type="button" onClick={payAward} disabled={busy}>{busy ? "Waiting for wallet…" : `Pay ${sol} SOL`}</button>{message ? <small className={message.includes("confirmed") ? "paid" : "pending"}>{message}</small> : null}</div>;
}

export function AwardPayoutButton(props: Props) {
  const wallet = useConnectedWallet(solanaClient);
  if (props.status !== "pending_payment" || !props.winner || !props.prizeWallet) return null;
  if (!wallet) return <small className="pending">Connect the prize wallet to pay</small>;
  if (wallet.account.address !== props.prizeWallet) return <small className="pending">Connect the prize wallet to pay</small>;
  return <PayoutAction account={wallet.account} {...props} winner={props.winner} />;
}
