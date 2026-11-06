"use client";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useSignMessage,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import { solanaClient } from "./solana-client";
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
export type AuthState = {
  configured: boolean;
  authenticated: boolean;
  eligible: boolean;
  wallet?: string;
  balance?: string;
  minimumTokens?: string;
};
export type WalletVerification = { verify: () => Promise<boolean> };

function assertConnectedWallet(address: string | undefined) {
  if (
    !address ||
    solanaClient.wallet.getState().connected?.account.address !== address
  ) {
    throw new Error(
      "Wallet changed during verification. Submit your squad again.",
    );
  }
}

export function WalletControl({
  onAuthChange,
  verificationRef,
}: {
  onAuthChange: (state: AuthState) => void;
  verificationRef: Ref<WalletVerification>;
}) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientHydrated,
    serverHydrated,
  );
  const wallets = useWallets(solanaClient);
  const detectedWallet = useConnectedWallet(solanaClient);
  const detectedStatus = useWalletStatus(solanaClient);
  const connected = hydrated ? detectedWallet : undefined;
  const status = hydrated ? detectedStatus : "pending";
  const connect = useConnect(solanaClient);
  const disconnect = useDisconnect(solanaClient);
  const signMessage = useSignMessage(solanaClient);
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<AuthState>({
    configured: false,
    authenticated: false,
    eligible: false,
  });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const address = connected?.account.address;
  const pendingVerification = useRef<((verified: boolean) => void) | null>(
    null,
  );
  const authRevision = useRef(0);

  useImperativeHandle(verificationRef, () => ({
    async verify() {
      if (auth.authenticated && auth.wallet === address) {
        assertConnectedWallet(auth.wallet);
        return auth.eligible;
      }
      if (address) {
        const verified = await verifyWallet(address);
        if (!verified) setOpen(true);
        return verified;
      }
      setOpen(true);
      return new Promise<boolean>((resolve) => {
        pendingVerification.current = resolve;
      });
    },
  }));

  useEffect(
    () => () => {
      pendingVerification.current?.(false);
      pendingVerification.current = null;
    },
    [],
  );

  function closeWalletMenu() {
    setOpen(false);
    pendingVerification.current?.(false);
    pendingVerification.current = null;
  }

  async function connectWallet(wallet: (typeof wallets)[number]) {
    try {
      await connect.dispatchAsync(wallet);
      const active = solanaClient.wallet.getState().connected;
      if (!active) throw new Error("Wallet connection failed.");
      const resume = pendingVerification.current;
      pendingVerification.current = null;
      setOpen(false);
      if (resume) {
        const verified = await verifyWallet(active.account.address);
        if (!verified) setOpen(true);
        resume(verified);
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Wallet connection failed.",
      );
      pendingVerification.current?.(false);
      pendingVerification.current = null;
    }
  }

  useEffect(() => {
    if (!address) {
      return;
    }
    let active = true;
    const revision = authRevision.current;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: AuthState) => {
        if (revision !== authRevision.current) return;
        if (active && result.authenticated && result.wallet === address) {
          const balance = result.balance as unknown as
            { displayBalance?: string; minimumTokens?: string } | undefined;
          const next = {
            ...result,
            balance: balance?.displayBalance,
            minimumTokens: balance?.minimumTokens,
          };
          setAuth(next);
          onAuthChange(next);
        } else if (active) {
          const next = {
            configured: result.configured,
            authenticated: false,
            eligible: false,
          };
          setAuth(next);
          onAuthChange(next);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [address, onAuthChange]);

  async function verifyWallet(walletAddress = address) {
    if (!walletAddress) return false;
    authRevision.current++;
    setAuthBusy(true);
    setAuthError("");
    try {
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress }),
      });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok)
        throw new Error(
          challenge.error || "Could not create sign-in challenge.",
        );
      assertConnectedWallet(walletAddress);
      const message = new TextEncoder().encode(challenge.message);
      const signature = await signMessage.dispatchAsync(message);
      const signatureBase64 = btoa(String.fromCharCode(...signature));
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          message: challenge.message,
          signature: signatureBase64,
        }),
      });
      const result = await verifyResponse.json();
      if (!verifyResponse.ok)
        throw new Error(result.error || "Wallet verification failed.");
      assertConnectedWallet(walletAddress);
      const balance = result.balance ?? {};
      const next = {
        configured: true,
        authenticated: true,
        eligible: Boolean(result.eligible),
        wallet: result.wallet,
        balance: balance.displayBalance,
        minimumTokens: balance.minimumTokens,
      };
      authRevision.current++;
      setAuth(next);
      onAuthChange(next);
      return next.eligible;
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Wallet verification failed.",
      );
      return false;
    } finally {
      setAuthBusy(false);
    }
  }

  async function disconnectWallet() {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    await disconnect.dispatch();
    const next = { configured: false, authenticated: false, eligible: false };
    setAuth(next);
    onAuthChange(next);
  }

  return (
    <div className="wallet-control">
      <button
        className={`wallet-button ${connected ? "connected" : ""}`}
        onClick={() => (open ? closeWalletMenu() : setOpen(true))}
        disabled={status === "pending" || status === "reconnecting"}
      >
        <span className="wallet-dot" />
        {connected
          ? shortAddress(connected.account.address)
          : status === "pending" || status === "reconnecting"
            ? "Finding wallets"
            : "Connect wallet"}
      </button>
      {open && (
        <>
          <button
            className="modal-scrim"
            aria-label="Close wallet menu"
            onClick={closeWalletMenu}
          />
          <div className="wallet-menu">
            <div className="wallet-menu-head">
              <div>
                <span>Solana wallet</span>
                <strong>
                  {connected ? "Wallet connected" : "Choose a wallet"}
                </strong>
              </div>
              <button aria-label="Close" onClick={closeWalletMenu}>
                ×
              </button>
            </div>
            {connected ? (
              <>
                <div className="wallet-connected-card">
                  <span className="wallet-big-dot" />
                  <div>
                    <b>{connected.wallet.name}</b>
                    <small>{connected.account.address}</small>
                  </div>
                  <button
                    onClick={disconnectWallet}
                    disabled={disconnect.isRunning}
                  >
                    Disconnect
                  </button>
                </div>
                {auth.authenticated ? (
                  <div
                    className={`holder-status ${auth.eligible ? "eligible" : "ineligible"}`}
                  >
                    <b>
                      {auth.eligible
                        ? "ELIGIBLE HOLDER"
                        : "HOLDER CHECK FAILED"}
                    </b>
                    <span>
                      {auth.balance ?? "Not checked"} $PFL · minimum{" "}
                      {auth.minimumTokens ?? "not set"}
                    </span>
                  </div>
                ) : (
                  <button
                    className="verify-wallet-button"
                    onClick={() => verifyWallet()}
                    disabled={authBusy || signMessage.isRunning}
                  >
                    {authBusy
                      ? "Verifying wallet…"
                      : auth.configured
                        ? "Sign message · check token balance"
                        : "Verify wallet to enter"}
                  </button>
                )}
              </>
            ) : wallets.length ? (
              <div className="wallet-options">
                {wallets.map((wallet) => (
                  <button
                    key={wallet.name}
                    onClick={() => connectWallet(wallet)}
                    disabled={connect.isRunning}
                  >
                    <span>{wallet.name.slice(0, 2).toUpperCase()}</span>
                    <b>{wallet.name}</b>
                    <i>Connect</i>
                  </button>
                ))}
              </div>
            ) : (
              <div className="no-wallet">
                <span>◫</span>
                <b>No Solana wallet found</b>
                <p>
                  Install Phantom, Solflare, or Backpack, then refresh this
                  page.
                </p>
              </div>
            )}
            {connect.error ? (
              <p className="wallet-error">
                {connect.error instanceof Error
                  ? connect.error.message
                  : "Wallet connection failed."}
              </p>
            ) : null}
            {authError ? <p className="wallet-error">{authError}</p> : null}
            <small className="wallet-safety">
              Connecting is free. Pump Fantasy League never asks for your
              recovery phrase.
            </small>
          </div>
        </>
      )}
    </div>
  );
}
