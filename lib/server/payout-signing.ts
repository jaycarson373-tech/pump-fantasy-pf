import { createPublicKey, verify } from "node:crypto";
import { address, createKeyPairSignerFromBytes, getAddressEncoder, getTransactionDecoder, getBase64EncodedWireTransaction, partiallySignTransaction, type KeyPairSigner } from "@solana/kit";

export function assertPayoutProof(unsignedBase64: string, signedBase64: string, wallet: string) {
  const decode=getTransactionDecoder(),unsigned=decode.decode(Buffer.from(unsignedBase64,"base64")),signed=decode.decode(Buffer.from(signedBase64,"base64"));
  const signature=signed.signatures[address(wallet)];
  const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(getAddressEncoder().encode(address(wallet)))]),format:"der",type:"spki"});
  if(!Buffer.from(unsigned.messageBytes).equals(Buffer.from(signed.messageBytes))||Object.keys(unsigned.signatures).length!==1||
    JSON.stringify(Object.keys(unsigned.signatures))!==JSON.stringify(Object.keys(signed.signatures))||!signature||
    !verify(null,Buffer.from(unsigned.messageBytes),key,Buffer.from(signature)))
    throw new Error("Payout signer changed the reviewed transaction or returned an invalid signature.");
  return signed;
}

const KEYPAIR_BYTES = 64;
const MAX_BYTE = 255;
const MAX_KEYPAIR_TEXT = 1024;

/** Strict parsing avoids Uint8Array silently truncating malformed key bytes. */
export async function readPayoutSigner(text: string, expectedWallet?: string): Promise<KeyPairSigner> {
  let signer: KeyPairSigner;
  try {
    if (text.length > MAX_KEYPAIR_TEXT) throw new Error();
    const values: unknown = JSON.parse(text);
    if (!Array.isArray(values) || values.length !== KEYPAIR_BYTES ||
        values.some(value => !Number.isInteger(value) || value < 0 || value > MAX_BYTE)) throw new Error();
    const bytes = Uint8Array.from(values);
    try { signer = await createKeyPairSignerFromBytes(bytes); }
    finally { bytes.fill(0); }
  } catch {
    throw new Error("Invalid payout keypair. Configure a valid 64-byte Solana JSON keypair.");
  }
  if (expectedWallet !== undefined && signer.address !== expectedWallet)
    throw new Error("Payout keypair does not match PF_PRIZE_WALLET_ADDRESS. Configure the matching wallet.");
  return signer;
}

/** Signing only; the caller persists the exact wire before broadcasting. */
export async function signPayoutTransaction(unsignedBase64: string, signer: KeyPairSigner) {
  const unsigned = getTransactionDecoder().decode(Buffer.from(unsignedBase64, "base64"));
  const required = Object.keys(unsigned.signatures);
  if (required.length !== 1 || required[0] !== signer.address)
    throw new Error("Payout wallet must be the sole required signer. Rebuild the transaction for the configured wallet.");
  const signed = await partiallySignTransaction([signer.keyPair], unsigned);
  const wire = getBase64EncodedWireTransaction(signed);
  assertPayoutProof(unsignedBase64, wire, signer.address);
  return wire;
}
