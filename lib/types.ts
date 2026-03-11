export type SortBy = "default" | "deltaDesc" | "deltaAsc";
export type GroupFilter = "all" | "ungrouped" | string;

export type LoadingState = "idle" | "loading" | "empty" | "noResult" | "error";
export type HistoryRange = "7D" | "30D" | "90D" | "180D" | "1Y";
export type HistoryLoadingState = "loading" | "ready" | "empty" | "error";

export type FundInstrumentType = "open_fund" | "etf" | "lof";
export type FundQuoteSource = "eastmoney_estimation" | "eastmoney_trends2";

export interface TrendPoint {
  ts: string;
  estimatedNav: number;
  deltaPercent: number;
}

export interface HistoryPoint {
  ts: string;
  nav: number;
  deltaPct: number;
}

export interface FundHistoryAnalysis {
  range: HistoryRange;
  points: HistoryPoint[];
  returnPct: number | null;
  maxDrawdownPct: number | null;
  periodHigh: { nav: number; ts: string } | null;
  periodLow: { nav: number; ts: string } | null;
  updatedAt: string | null;
  fromCache: boolean;
}

export interface PositionSnapshot {
  code: string;
  shares: number;
  costPerUnit: number;
  updatedAt: string;
}

export interface PositionMetrics {
  costTotal: number | null;
  marketValue: number | null;
  totalPnl: number | null;
  totalPnlPct: number | null;
  dailyPnl: number | null;
  hasPosition: boolean;
}

export interface FundGroup {
  id: string;
  name: string;
  sortOrder: number;
  fundCount: number;
}

export interface FundGroupMembership {
  groupId: string;
  groupName: string;
}

export interface GroupTabStat {
  id: string;
  name: string;
  fundCount: number;
  avgDeltaPercent: number | null;
  kind: "all" | "manual" | "ungrouped";
}

export interface GroupPerformanceSummary {
  groupId: GroupFilter;
  groupName: string;
  memberCount: number;
  todayAvgDeltaPct: number | null;
  sevenDayReturnPct: number | null;
  updatedAt: string | null;
}

export interface FundReviewNote {
  id: string;
  code: string;
  title: string;
  reviewDate: string;
  expectation: string;
  result: string;
  reason: string;
  actionPlan: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type DecisionChecklistStatus = "todo" | "done" | "invalid";
export type DecisionChecklistPriority = "high" | "medium" | "low";

export interface DecisionChecklistItem {
  id: string;
  code: string;
  tradeDate: string;
  triggerCondition: string;
  actionPlan: string;
  invalidCondition: string;
  reviewNote: string;
  status: DecisionChecklistStatus;
  priority: DecisionChecklistPriority;
  archivedReviewId: string | null;
  updatedAt: string;
}

export interface DecisionPanelSummary {
  todoCount: number;
  doneCount: number;
  invalidCount: number;
  winRateHint: number | null;
}

export interface FocusedFundState {
  focusedCode: string | null;
  focusedAt: string | null;
}

export interface BatchSelectionState {
  isSelecting: boolean;
  selectedCodes: string[];
  pendingAction: "idle" | "applyGroup" | "delete";
  batchError?: string | null;
}

export interface FundCardData {
  code: string;
  name: string;
  nav: number | null;
  estimatedNav: number | null;
  deltaValue: number | null;
  deltaPercent: number | null;
  asOfDate: string | null;
  asOfTime: string | null;
  trendPoints: TrendPoint[];
  stale: boolean;
  instrumentType: FundInstrumentType;
  source: FundQuoteSource | null;
  position: PositionSnapshot | null;
  positionMetrics: PositionMetrics;
  groups: FundGroupMembership[];
  latestReview: FundReviewNote | null;
  decisionSummary?: DecisionPanelSummary;
}

export interface UIState {
  query: string;
  sortBy: SortBy;
  groupFilter: GroupFilter;
  funds: FundCardData[];
  groups?: FundGroup[];
  groupTabs?: GroupTabStat[];
  selectedFund?: string;
  expandedFundCode?: string;
  historyStateByFund?: Record<string, HistoryLoadingState>;
  historyRangeByFund?: Record<string, HistoryRange>;
  editingPositionFundCode?: string;
  positionSavingByFund?: Record<string, boolean>;
  reviewSelectedIdByFund?: Record<string, string | null>;
  reviewDraftDirty?: boolean;
  reviewListQueryByFund?: Record<string, string>;
  maskAmounts?: boolean;
  isAddOpen: boolean;
  isRefreshing: boolean;
  lastUpdatedAt: string | null;
  loadingState: LoadingState;
}

export interface SystemStatus {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  sourceHealthy: boolean;
  isTradingDay: boolean;
  isTradingTime: boolean;
}

export interface FundEstimationSourceRecord {
  code: string;
  name: string;
  nav: number;
  estimatedNav: number;
  deltaPercent: number;
  asOf: string;
  instrumentType: FundInstrumentType;
  source: FundQuoteSource;
}

export interface WatchlistItem {
  code: string;
  createdAt: string;
}
