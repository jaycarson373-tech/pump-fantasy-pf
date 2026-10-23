import { createPublicKey, verify } from "node:crypto";
import { address, getAddressEncoder, getTransactionDecoder } from "@solana/kit";

export function assertManagedPayoutProof(unsignedBase64: string, signedBase64: string, wallet: string) {
  const decode=getTransactionDecoder(),unsigned=decode.decode(Buffer.from(unsignedBase64,"base64")),signed=decode.decode(Buffer.from(signedBase64,"base64"));
  const signature=signed.signatures[address(wallet)];
  const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(getAddressEncoder().encode(address(wallet)))]),format:"der",type:"spki"});
  if(!Buffer.from(unsigned.messageBytes).equals(Buffer.from(signed.messageBytes))||Object.keys(unsigned.signatures).length!==1||
    JSON.stringify(Object.keys(unsigned.signatures))!==JSON.stringify(Object.keys(signed.signatures))||!signature||
    !verify(null,Buffer.from(unsigned.messageBytes),key,Buffer.from(signature)))
    throw new Error("Managed signer changed the reviewed transaction or returned an invalid signature.");
  return signed;
}
