export type User = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  status: "active" | "suspended" | "withdrawn";
  phone: string;
  walletAddress?: string | null;
  mockCreditBalance?: number;
};
export type Farm = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  status: string;
  description: string;
  ownerId: string;
  containerCount?: number;
  containers?: Container[];
};
export type Container = {
  id: string;
  farmId: string;
  name: string;
  cropName: string;
  status: string;
  description: string;
  plantedAt: string;
  harvestAt: string;
  tokenId: string;
  totalTokenSupply: number;
  availableTokenQuantity: number;
  tokenPrice: number;
  initialTokenPrice?: number;
  marketAvailableQuantity?: number;
  lowestAskPrice?: number | null;
  lastExecutionPrice?: number | null;
  issuerId?: string | null;
  tokenStatus?: "requested" | "approved" | "issued" | "suspended";
  executionVenue?: "INTERNAL" | "BROKER" | "PUBLIC_CHAIN";
  publicChainTokenId?: string;
  rackViews?: RackView[];
  updatedAt?: string;
  farm?: Farm;
};
export type RackView = {
  id: string;
  label: string;
  detail: string;
};
export type Sensor = {
  containerId: string;
  temperature: number;
  humidity: number;
  light: number;
  co2: number;
  soilMoisture: number;
  ph: number;
  ec: number;
  updatedAt: string;
  history: number[];
};
export type Order = {
  id: string;
  tokenId: string;
  containerId: string;
  sellerName: string;
  quantity: number;
  originalQuantity?: number;
  remainingQuantity?: number;
  unitPrice: number;
  status: string;
  createdAt: string;
  container: Container;
};
export type Holding = {
  id: string;
  tokenId: string;
  containerId: string;
  quantity: number;
  availableQuantity?: number;
  reservedQuantity?: number;
  unsettledQuantity?: number;
  settledQuantity?: number;
  averagePrice: number;
  container: Container;
};
export type TokenPosition = {
  userId: string;
  tokenId: string;
  containerId: string;
  availableQuantity: number;
  reservedQuantity: number;
  unsettledQuantity: number;
  settledQuantity: number;
  updatedAt: string;
};
export type TokenOrder = {
  id: string;
  userId: string;
  tokenId: string;
  containerId: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  limitPrice: number | null;
  originalQuantity: number;
  remainingQuantity: number;
  status:
    | "pending"
    | "open"
    | "partially_filled"
    | "filled"
    | "cancelled"
    | "rejected";
  executionVenue: "INTERNAL" | "BROKER" | "PUBLIC_CHAIN";
  externalOrderId: string | null;
  idempotencyKey: string | null;
  legacyOrderId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type TokenExecution = {
  id: string;
  buyOrderId: string | null;
  sellOrderId: string | null;
  buyerId: string;
  sellerId: string;
  tokenId: string;
  quantity: number;
  unitPrice: number;
  externalExecutionId: string | null;
  executedAt: string;
};
export type TradingInstrument = {
  id: string;
  symbol: string;
  name: string;
  cropName: string;
  assetType: "SMART_FARM_PARTICIPATION_TOKEN";
  issuerId: string;
  currency: "MOCK_KRW";
  totalSupply: number;
  initialPrice: number;
  executionVenue: "INTERNAL" | "BROKER" | "PUBLIC_CHAIN";
  status: "requested" | "approved" | "issued" | "suspended";
};
export type TokenQuote = {
  tokenId: string;
  initialPrice: number;
  lowestAsk: number | null;
  highestBid: number | null;
  lastPrice: number | null;
  weightedAveragePrice: number | null;
};
export type TokenRequest = {
  id: string;
  containerId: string;
  containerName: string;
  cropName: string;
  farmName: string;
  issuerId: string;
  issuerName: string;
  symbol: string;
  totalSupply: number;
  initialPrice: number;
  status: "requested" | "approved" | "issued" | "suspended";
  executionVenue: "INTERNAL" | "BROKER" | "PUBLIC_CHAIN";
  createdAt: string;
  updatedAt: string;
};
export type Wallet = {
  holdings: Holding[];
  openOrders: Order[];
  positions: TokenPosition[];
  availableTokens: number;
  listedTokens: number;
  totalTokens: number;
  settledTokens: number;
  unsettledTokens: number;
  totalValue: number;
  mockCreditBalance: number;
  paymentProvider: "mock";
  transactions: Array<{
    id: string;
    type: string;
    tokenId: string;
    quantity: number;
    unitPrice: number;
    createdAt: string;
  }>;
};
export type Dashboard = {
  wallet: {
    linkedAccount: { bankName: string; balance: number } | null;
    totalAssets: number;
    mockCreditBalance: number;
    holdingValue: number;
    totalTokens: number;
    openOrderCount: number;
    openOrders: Order[];
    recentTransactions: Wallet["transactions"];
    holdings: Holding[];
  };
  farmCount: number;
  containerCount: number;
  alerts: Array<{ id: string; message: string; level: string }>;
};
export type Device = {
  id: string;
  containerId: string;
  name: string;
  deviceType: "sensor" | "controller" | "camera";
  keyPrefix: string;
  status: string;
  lastSeenAt: string | null;
};
export type LedgerBlock = {
  height: number;
  blockHash: string;
  eventType: string;
  entityType: string;
  entityId: string;
  createdAt: string;
};
export type AdminSummary = {
  farmCount: number;
  containerCount: number;
  issuedTokens: number;
  onlineDevices: number;
  queuedCommands: number;
  ledgerBlocks: number;
};
export type PublicChainStatus = {
  enabled: boolean;
  relayerEnabled: boolean;
  chainId: number;
  chainName: string;
  assetAddress: string | null;
  marketplaceAddress: string | null;
  explorerUrl: string | null;
  relayerAddress: string | null;
  mode: "evm" | "disabled";
};
export type PublicChainOperation = {
  id: string;
  operationType: string;
  entityType: string;
  entityId: string;
  status: string;
  txHash: string | null;
  blockNumber: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
