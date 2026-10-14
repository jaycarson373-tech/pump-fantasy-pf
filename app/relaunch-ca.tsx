"use client";

import { useState } from "react";

const CONTRACT_ADDRESS = "51MVoyg5tEPxFMLWsojiz3gnN35nz6gPKzaGqNMEpump";

export function RelaunchContractAddress() {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="relaunch-ca" aria-label="Fantasy token contract address">
      <span className="relaunch-ca-label">CA</span>
      <code title={CONTRACT_ADDRESS}>{CONTRACT_ADDRESS}</code>
      <button type="button" onClick={copyAddress} aria-label="Copy Fantasy token contract address">
        {copied ? "COPIED" : "COPY"}
      </button>
    </div>
  );
}
