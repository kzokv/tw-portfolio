export * from "./events.js";

export type CostBasisMethod = "WEIGHTED_AVERAGE";
export type LocaleCode = "en" | "zh-TW";
export type InstrumentType = "STOCK" | "ETF" | "BOND_ETF";
export type CurrencyCode = string;
export type DividendSourceBucket =
  | "DIVIDEND_INCOME"
  | "INTEREST_INCOME"
  | "SECURITIES_GAIN_INCOME"
  | "REVENUE_EQUALIZATION"
  | "CAPITAL_EQUALIZATION"
  | "CAPITAL_RETURN"
  | "OTHER";
export type SourceCompositionStatus = "provided" | "unknown_pending_disclosure";

export interface DividendSourceLine {
  id: string;
  dividendLedgerEntryId: string;
  sourceBucket: DividendSourceBucket;
  amount: number;
  currencyCode: CurrencyCode;
  source: string;
  sourceReference?: string;
  note?: string;
  bookedAt?: string;
}

export interface UserSettings {
  userId: string;
  displayName?: string | null;
  locale: LocaleCode;
  costBasisMethod: CostBasisMethod;
  quotePollIntervalSeconds: number;
}

export interface FeeProfileDto {
  id: string;
  name: string;
  boardCommissionRate: number;
  commissionDiscountPercent: number;
  minimumCommissionAmount: number;
  commissionCurrency: CurrencyCode;
  commissionRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  taxRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
  commissionChargeMode: "CHARGED_UPFRONT" | "CHARGED_UPFRONT_REBATED_LATER";
}

export interface AccountDto {
  id: string;
  name: string;
  userId: string;
  feeProfileId: string;
}

export interface FeeProfileBindingDto {
  accountId: string;
  ticker: string;
  feeProfileId: string;
}

export interface IntegrityIssueDto {
  code: string;
  message: string;
}

export interface DashboardOverviewSummaryDto {
  asOf: string;
  accountCount: number;
  holdingCount: number;
  totalCostAmount: number;
  totalCostCurrency: CurrencyCode;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  dailyChangeAmount: number | null;
  dailyChangePercent: number | null;
  upcomingDividendCount: number;
  upcomingDividendAmount: number | null;
  openIssueCount: number;
}

export interface DashboardOverviewHoldingDto {
  accountId: string;
  ticker: string;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
  averageCostPerShare: number;
  currentUnitPrice: number | null;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  allocationPct: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  quoteStatus: "current" | "provisional" | "missing";
  nextDividendDate: string | null;
  lastDividendPostedDate: string | null;
}

export interface DashboardOverviewUpcomingDividendDto {
  accountId: string;
  ticker: string;
  exDividendDate: string | null;
  paymentDate: string | null;
  expectedAmount: number | null;
  currency: CurrencyCode;
  status: "declared" | "expected" | "paying-soon";
}

export interface DashboardOverviewRecentDividendDto {
  accountId: string;
  ticker: string;
  postedAt: string;
  netAmount: number;
  grossAmount: number | null;
  deductionAmount: number | null;
  currency: CurrencyCode;
  sourceSummary: string | null;
  status: "posted" | "unreconciled";
}

export interface InstrumentOptionDto {
  ticker: string;
  instrumentType: InstrumentType;
  marketCode: string | null;
  isProvisional: boolean;
}

export interface DashboardOverviewDto {
  settings: UserSettings;
  summary: DashboardOverviewSummaryDto;
  holdings: DashboardOverviewHoldingDto[];
  dividends: {
    upcoming: DashboardOverviewUpcomingDividendDto[];
    recent: DashboardOverviewRecentDividendDto[];
  };
  actions: {
    integrityIssue: IntegrityIssueDto | null;
    recomputeAvailable: boolean;
  };
  instruments: InstrumentOptionDto[];
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
}

export type DashboardPerformanceRange = "1M" | "3M" | "YTD" | "1Y";

export interface DashboardPerformancePointDto {
  date: string;
  totalCostAmount: number;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  cumulativeRealizedPnlAmount?: number;
  cumulativeDividendsAmount?: number;
  totalReturnAmount?: number | null;
  totalReturnPercent?: number | null;
}

export interface DashboardPerformanceDto {
  range: DashboardPerformanceRange;
  points: DashboardPerformancePointDto[];
}

export interface TransactionHistoryItemDto {
  id: string;
  accountId: string;
  ticker: string;
  marketCode: string | null;
  instrumentType: InstrumentType;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  tradeTimestamp: string | null;
  bookingSequence: number | null;
  commissionAmount: number;
  taxAmount: number;
  isDayTrade: boolean;
  realizedPnlAmount: number | null;
  realizedPnlCurrency: CurrencyCode | null;
  feeProfileId: string;
  feeProfileName: string;
  bookedAt: string | null;
  feesSource: "CALCULATED" | "MANUAL";
}

export interface PreviewImpactResponse {
  affectedRows: {
    cashLedgerEntries: number;
    lotAllocations: number;
    feePolicySnapshots: number;
    holdingSnapshots: number;
  };
  negativeLots: {
    wouldOccur: boolean;
    resultingQuantity: number;
    ticker: string;
  };
}

export interface DeleteTransactionResponse {
  accountId: string;
  ticker: string;
  deletedTradeEventId: string;
  deletedChildRows: {
    cashLedgerEntries: number;
    lotAllocations: number;
  };
}

export interface PatchTransactionResponse {
  accountId: string;
  ticker: string;
  updatedTradeEventId: string;
  changedFields: string[];
}

export interface PatchFeeConfirmationResponse {
  requiresFeeConfirmation: true;
  tradeEventId: string;
}

export interface UserIdentity {
  userId: string;
  email: string | null;
  displayName: string | null;
  locale: LocaleCode;
  createdAt: string;
  updatedAt: string;
}

export interface UserExternalIdentity {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  providerEmail: string | null;
  providerDisplayName: string | null;
  providerPictureUrl: string | null;
  linkedAt: string;
  lastSeenAt: string;
}

export type UserRole = "admin" | "member" | "viewer";

export interface ProfileDto {
  userId: string;
  email: string | null;
  displayName: string | null;
  providerPictureUrl: string | null;
  providerDisplayName: string | null;
  linkedAt: string | null;
  lastSeenAt: string | null;
  role: UserRole;
}

// ── Admin portal DTOs (KZO-144) ──────────────────────────────────────────────

export type AdminUserStatus = "active" | "disabled" | "deleted";

export interface AdminUserListItemDto {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  status: AdminUserStatus;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AdminUserListResponse {
  items: AdminUserListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export type InviteListStatus = "pending" | "used" | "expired" | "revoked";

export interface AdminInviteListItemDto {
  code: string;
  email: string;
  role: UserRole;
  status: InviteListStatus;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  issuedByEmail: string | null;
  issuedByDisplayName: string | null;
  createdAt: string;
}

export interface AdminInviteListResponse {
  items: AdminInviteListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminAuditLogEntryDto {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  targetDisplayName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface AdminAuditLogResponse {
  items: AdminAuditLogEntryDto[];
  total: number;
  page: number;
  limit: number;
}

// ── Sharing types (KZO-145 / KZO-146) ──────────────────────────────────────

export interface ShareGrantDto {
  id: string;
  status: "active" | "revoked";
  ownerUserId: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  granteeUserId: string;
  granteeEmail: string | null;
  granteeDisplayName: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

export interface PendingShareInviteDto {
  code: string;
  status: "pending" | "expired" | "revoked";
  email: string;
  role: UserRole;
  shareOwnerUserId: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
  inviteUrl: string | null;
}

export type OutboundShareHistoryItemDto = ShareGrantDto | PendingShareInviteDto;

export interface SharesListResponseDto {
  outbound: {
    active: ShareGrantDto[];
    pending: PendingShareInviteDto[];
    expired: PendingShareInviteDto[];
    revoked: OutboundShareHistoryItemDto[];
  };
  inbound: {
    active: ShareGrantDto[];
    revoked: ShareGrantDto[];
  };
}

export type CreateShareResponseDto =
  | {
      type: "resolved";
      share: ShareGrantDto;
    }
  | {
      type: "pending";
      invite: PendingShareInviteDto;
    };

export interface QuoteSnapshotDto {
  ticker: string;
  close: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string;
  source: string;
  isProvisional: boolean;
}

export type MonitoredTickerSource = "manual" | "position";

export interface MonitoredTickerDto {
  ticker: string;
  source: MonitoredTickerSource;
  name: string | null;
  instrumentType: InstrumentType | null;
  barsBackfillStatus: string | null;
  lastRepairAt: string | null;
  /** KZO-133: earliest ISO time the ticker can be repaired; null when no prior repair. */
  repairAvailableAt: string | null;
}

export interface InstrumentCatalogItemDto {
  ticker: string;
  name: string | null;
  instrumentType: InstrumentType | null;
  marketCode: string;
  barsBackfillStatus: string;
  lastRepairAt: string | null;
  /** KZO-133: earliest ISO time the instrument can be repaired; null when no prior repair. */
  repairAvailableAt: string | null;
}

// ── Notification types (KZO-132) ────────────────────────────────────────────

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationDto {
  id: string;
  userId: string;
  severity: NotificationSeverity;
  source: string;
  sourceRef: string | null;
  title: string;
  body: string | null;
  detail: unknown;
  readAt: string | null;
  escalatedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationListResponse {
  notifications: NotificationDto[];
  total: number;
  page: number;
  limit: number;
}

export interface UnreadCountResponse {
  count: number;
}

// ── Dividend ledger aggregates (KZO-135) ────────────────────────────────────

export type CurrencyAmounts = Record<string, number>;
export type CurrencyExpectedReceived = Record<string, { expected: number; received: number }>;

export interface DividendLedgerAggregates {
  totalExpectedCashAmount: CurrencyAmounts;
  totalReceivedCashAmount: CurrencyAmounts;
  openCount: number;
  byMonth: Record<string, CurrencyExpectedReceived>;
  byTicker: Record<string, CurrencyExpectedReceived>;
}
