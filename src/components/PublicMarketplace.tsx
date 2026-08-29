import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, Link2, ShieldCheck } from "lucide-react";
import { encodeFunctionData, parseAbi, toHex } from "viem";
import { api } from "../api";
import type { Container, PublicChainStatus } from "../model";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
const assetsAbi = parseAbi([
  "function setApprovalForAll(address operator,bool approved)",
]);
const marketAbi = parseAbi([
  "function createListing(uint256 tokenId,uint256 quantity,uint256 unitPrice) returns (uint256)",
  "function purchase(uint256 listingId,uint256 quantity) payable",
]);

export function PublicMarketplace({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [chain, setChain] = useState<PublicChainStatus | null>(null),
    [containers, setContainers] = useState<Container[]>([]);
  useEffect(() => {
    api<PublicChainStatus>("/public-chain/status")
      .then(setChain)
      .catch(() => undefined);
    api<Container[]>("/containers")
      .then(setContainers)
      .catch(() => undefined);
  }, []);
  const provider = () =>
    (window as typeof window & { ethereum?: EthereumProvider }).ethereum;
  async function account() {
    const ethereum = provider();
    if (!ethereum) throw new Error("EVM 지갑을 설치해 주세요.");
    const accounts = (await ethereum.request({
      method: "eth_requestAccounts",
    })) as string[];
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHex(chain!.chainId) }],
    });
    return { ethereum, address: accounts[0] };
  }
  async function send(to: string, data: string, value?: bigint) {
    const { ethereum, address } = await account();
    return ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: address,
          to,
          data,
          ...(value !== undefined ? { value: toHex(value) } : {}),
        },
      ],
    }) as Promise<string>;
  }
  async function approve() {
    try {
      const tx = await send(
        chain!.assetAddress!,
        encodeFunctionData({
          abi: assetsAbi,
          functionName: "setApprovalForAll",
          args: [chain!.marketplaceAddress! as `0x${string}`, true],
        }),
      );
      notify(`거래소 승인 제출: ${tx}`);
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function list(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const token = containers.find((item) => item.id === values.containerId);
      if (!token?.publicChainTokenId)
        throw new Error("온체인 토큰 ID가 없습니다.");
      const tx = await send(
        chain!.marketplaceAddress!,
        encodeFunctionData({
          abi: marketAbi,
          functionName: "createListing",
          args: [
            BigInt(token.publicChainTokenId),
            BigInt(String(values.quantity)),
            BigInt(String(values.unitPriceWei)),
          ],
        }),
      );
      notify(`퍼블릭 판매 등록 제출: ${tx} · 블록 확인 중`);
      await api("/public-chain/marketplace/confirm", {
        method: "POST",
        body: JSON.stringify({ txHash: tx }),
      });
      notify(`퍼블릭 판매 등록이 블록에서 확인되었습니다: ${tx}`);
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function buy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const tx = await send(
        chain!.marketplaceAddress!,
        encodeFunctionData({
          abi: marketAbi,
          functionName: "purchase",
          args: [
            BigInt(String(values.listingId)),
            BigInt(String(values.quantity)),
          ],
        }),
        BigInt(String(values.totalWei)),
      );
      notify(`퍼블릭 구매 제출: ${tx} · 블록 확인 중`);
      await api("/public-chain/marketplace/confirm", {
        method: "POST",
        body: JSON.stringify({ txHash: tx }),
      });
      notify(`퍼블릭 구매가 블록에서 확인되었습니다: ${tx}`);
    } catch (error) {
      notify((error as Error).message);
    }
  }
  if (!chain?.enabled || !chain.marketplaceAddress)
    return (
      <section className="public-market disabled">
        <Link2 />
        <div>
          <strong>퍼블릭 체인 거래 비활성</strong>
          <p>
            현재 화면의 거래는 개발용 모의 크레딧입니다. 컨트랙트 배포와
            환경변수 설정 후 온체인 거래가 열립니다.
          </p>
        </div>
      </section>
    );
  return (
    <section className="public-market">
      <header>
        <div>
          <ShieldCheck />
          <span>
            <strong>{chain.chainName} 퍼블릭 거래</strong>
            <small>
              ERC-1155 에스크로 거래소 · 모든 전송은 지갑 서명이 필요합니다.
            </small>
          </span>
        </div>
        {chain.explorerUrl && (
          <a
            href={`${chain.explorerUrl}/address/${chain.marketplaceAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            탐색기 <ExternalLink />
          </a>
        )}
      </header>
      <div className="public-market-grid">
        <div>
          <h3>1. 거래소 승인</h3>
          <p>판매 전에 ERC-1155 이동 권한을 거래소에 승인합니다.</p>
          <button className="outline-btn" onClick={approve}>
            판매 권한 승인
          </button>
        </div>
        <form onSubmit={list}>
          <h3>2. 온체인 판매 등록</h3>
          <label className="field">
            컨테이너
            <select name="containerId" required>
              <option value="">선택</option>
              {containers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label className="field">
              수량
              <input name="quantity" type="number" min="1" required />
            </label>
            <label className="field">
              개당 가격(wei)
              <input name="unitPriceWei" inputMode="numeric" required />
            </label>
          </div>
          <button className="primary-btn">지갑으로 판매 등록</button>
        </form>
        <form onSubmit={buy}>
          <h3>3. 온체인 구매</h3>
          <div className="form-row">
            <label className="field">
              Listing ID
              <input name="listingId" inputMode="numeric" required />
            </label>
            <label className="field">
              수량
              <input name="quantity" type="number" min="1" required />
            </label>
          </div>
          <label className="field">
            총 결제액(wei)
            <input name="totalWei" inputMode="numeric" required />
          </label>
          <button className="primary-btn">지갑으로 구매</button>
        </form>
      </div>
    </section>
  );
}
