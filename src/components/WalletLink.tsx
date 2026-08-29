import { useState } from "react";
import { Link, WalletCards } from "lucide-react";
import { api } from "../api";
import type { User } from "../model";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export function WalletLink({
  user,
  update,
}: {
  user: User;
  update: (user: User) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function connect() {
    const ethereum = (window as typeof window & { ethereum?: EthereumProvider })
      .ethereum;
    if (!ethereum) {
      setMessage("MetaMask 등 EVM 지갑을 먼저 설치해 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const challenge = await api<{ message: string }>("/me/wallet/challenge", {
        method: "POST",
      });
      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [challenge.message, accounts[0]],
      })) as string;
      const next = await api<User>("/me/wallet/verify", {
        method: "POST",
        body: JSON.stringify({ address: accounts[0], signature }),
      });
      update(next);
      setMessage("퍼블릭 체인 지갑을 서명으로 연결했습니다.");
    } catch (error) {
      setMessage(
        (error as Error).message || "지갑 연결을 완료하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="wallet-link">
      <div>
        <WalletCards />
        <span>
          <strong>퍼블릭 체인 지갑</strong>
          <small>{user.walletAddress || "아직 연결되지 않음"}</small>
        </span>
      </div>
      <button className="outline-btn" onClick={connect} disabled={busy}>
        <Link />
        {busy
          ? "서명 확인 중…"
          : user.walletAddress
            ? "지갑 다시 연결"
            : "지갑 연결"}
      </button>
      {message && <p>{message}</p>}
    </section>
  );
}
