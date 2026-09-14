import { fail } from "./shared.js";
import { listPublicSellOrders, placeSellOrder, purchaseSellOrder, cancelSellOrder } from "./orders.js";
import { requestIssuance, approveIssuance } from "./issuance.js";
import {
  cancelOrder,
  placeOrder,
  getOrder,
  listOrders,
  listExecutions,
  listPositions,
  listInstruments,
  getQuote,
} from "./book.js";

export class BrokerTradingProvider {
  constructor({ providerName = "BROKER_SANDBOX" } = {}) {
    this.providerName = providerName;
  }

  capabilities() {
    return {
      provider: this.providerName,
      executionVenue: "BROKER",
      connected: false,
      mode: "sandbox-boundary",
      message:
        "외부 증권사·거래 플랫폼 연동은 계약, 계좌 연결, webhook 서명, reconciliation이 확정된 뒤 adapter에서 활성화합니다.",
    };
  }

  async placeOrder() {
    throw fail("외부 거래 adapter가 아직 연결되지 않았습니다.", 503);
  }
}

// Thin wiring layer: the actual order/ledger/issuance logic lives in
// ./trading/*.js, split by responsibility. This just binds each function to
// this provider's (db, store) pair so app.js keeps calling trading.xxx(args)
// exactly as before.
export function createInternalTradingProvider({ db, store }) {
  return Object.freeze({
    name: "InternalTradingProvider",
    executionVenue: "INTERNAL",
    listPublicSellOrders: (args) => listPublicSellOrders(db, args),
    placeSellOrder: (args) => placeSellOrder(db, store, args),
    purchaseSellOrder: (args) => purchaseSellOrder(db, store, args),
    cancelSellOrder: (args) => cancelSellOrder(db, store, args),
    cancelOrder: (args) => cancelOrder(db, store, args),
    requestIssuance: (args) => requestIssuance(db, store, args),
    approveIssuance: (args) => approveIssuance(db, store, args),
    placeOrder: (args) => placeOrder(db, store, args),
    getOrder: (id) => getOrder(db, id),
    listOrders: (args) => listOrders(db, args),
    listExecutions: (args) => listExecutions(db, args),
    listPositions: (userId) => listPositions(db, userId),
    listInstruments: () => listInstruments(db),
    getQuote: (tokenId) => getQuote(db, tokenId),
  });
}
