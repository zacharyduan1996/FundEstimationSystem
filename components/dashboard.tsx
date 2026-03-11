"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  CheckSquare2,
  ChartNoAxesCombined,
  ClipboardList,
  Clock3,
  Eye,
  EyeOff,
  Folders,
  FolderCog,
  GripVertical,
  Inbox,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X
} from "lucide-react";
import HistoryLineChart from "@/components/history-line-chart";
import Sparkline from "@/components/sparkline";
import { REFRESH_INTERVAL_MS } from "@/lib/constants";
import { DEFAULT_HISTORY_RANGE } from "@/lib/history";
import type {
  DecisionChecklistItem,
  DecisionChecklistPriority,
  FundReviewNote,
  FundCardData,
  FundGroup,
  GroupPerformanceSummary,
  FundHistoryAnalysis,
  GroupFilter,
  GroupTabStat,
  HistoryLoadingState,
  HistoryRange,
  LoadingState,
  PositionSnapshot,
  SortBy
} from "@/lib/types";

type FundsResponse = {
  workspace: string;
  query: string;
  sortBy: SortBy;
  groupFilter: GroupFilter;
  groups: FundGroup[];
  groupTabs: GroupTabStat[];
  groupPerformance: GroupPerformanceSummary;
  focusedCode: string | null;
  decisionSummaryByFund?: Record<
    string,
    {
      todoCount: number;
      doneCount: number;
      invalidCount: number;
      winRateHint: number | null;
    }
  >;
  funds: FundCardData[];
  loadingState: LoadingState;
  lastUpdatedAt: string | null;
};

type ApiErrorResponse = {
  error?: string;
  message?: string;
};

type ToastState = {
  id: number;
  tone: "success" | "error" | "info";
  message: string;
};

type HistoryResponse = {
  code: string;
  range: HistoryRange;
  startDate: string;
  endDate: string;
  analysis: FundHistoryAnalysis;
};

type HistoryPanelData = {
  startDate: string;
  endDate: string;
  analysis: FundHistoryAnalysis;
};

type HistoryCache = Record<string, Partial<Record<HistoryRange, HistoryPanelData>>>;

type PositionResponse = {
  snapshot: PositionSnapshot;
};

type GroupResponse = {
  group?: FundGroup;
  groups?: FundGroup[];
  error?: string;
};

type ReviewListResponse = {
  code: string;
  notes: FundReviewNote[];
};

type ReviewResponse = {
  note: FundReviewNote;
};

type ChecklistResponse = {
  code: string;
  date: string;
  items: DecisionChecklistItem[];
};

const sortOptions: Array<{ value: SortBy; label: string; icon: ReactNode }> = [
  { value: "default", label: "默认", icon: <SlidersHorizontal size={14} /> },
  { value: "deltaDesc", label: "涨幅优先", icon: <TrendingUp size={14} /> },
  { value: "deltaAsc", label: "跌幅优先", icon: <TrendingDown size={14} /> }
];

const historyRanges: HistoryRange[] = ["7D", "30D", "90D", "180D", "1Y"];
const intradayAxisTicks = ["09:30", "10:30", "11:30", "14:00", "15:00"] as const;

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function formatNumber(value: number | null, digits = 4): string {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  return value.toFixed(digits);
}

function formatCurrency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}¥${absolute.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function maskMoney(value: string, masked: boolean): string {
  if (!masked || value === "--") {
    return value;
  }

  return "****";
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function deltaClass(value: number | null): "rise" | "fall" | "flat" {
  if (value === null || value === 0) {
    return "flat";
  }

  return value > 0 ? "rise" : "fall";
}

function trendAxisLabel(): { start: string; end: string } {
  return { start: "09:30", end: "15:00" };
}

function formatLastUpdatedAt(value: string | null): string {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
}

function formatHistoryRangeLabel(range: HistoryRange): string {
  if (range === "1Y") {
    return "最近1年净值";
  }

  return `最近${range.replace("D", "天")}净值`;
}

function formatDateOnly(value: string | null): string {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai"
  });
}

function formatReviewSummary(note: FundReviewNote | null): string {
  if (!note) {
    return "还没有复盘记录，建议记录预期与结果，便于后续复盘。";
  }
  return `结果：${note.result}`;
}

function formatHistoryAxisDate(value: string | null, range: HistoryRange): string {
  if (!value) {
    return "--";
  }

  const format = range === "7D" || range === "30D" ? "month-day" : "full-date";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(format === "month-day"
      ? { month: "2-digit", day: "2-digit" }
      : { year: "numeric", month: "2-digit", day: "2-digit" })
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}

function formatShares(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  return `${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 份`;
}

function classifyFetchFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "";
    }
    if (/data_source_unavailable|数据源暂时不可用/i.test(error.message)) {
      return "数据源暂时不可用，已保留上次结果";
    }
    if (/network|fetch failed|Failed to fetch|网络/i.test(error.message)) {
      return "网络连接异常，请检查后重试";
    }
    return error.message;
  }

  return "系统异常，请稍后重试";
}

function getTodayShanghaiDateString(): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return formatted;
}

function LoadingExample() {
  return (
    <article className="fund-card skeleton-card" aria-hidden="true">
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-subtitle" />
      <div className="skeleton-line" style={{ width: "55%", height: 20 }} />
      <div className="skeleton-metrics">
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </div>
      <div className="skeleton-line skeleton-time" />
      <div className="skeleton-block skeleton-chart" />
    </article>
  );
}

function EmptyExample() {
  return (
    <section className="state-card state-center">
      <Inbox size={20} className="text-muted" />
      <p className="state-title">还没有添加基金</p>
      <p className="state-text">点击上方“添加基金”开始追踪</p>
    </section>
  );
}

function NoResultExample({
  onClear,
  groupFilter,
  activeGroupName
}: {
  onClear: () => void;
  groupFilter: GroupFilter;
  activeGroupName: string;
}) {
  const title = groupFilter !== "all" ? `当前分组“${activeGroupName}”暂无匹配` : "没有匹配结果";
  const text = groupFilter !== "all" ? "可切换分组标签或清空搜索" : "未找到该关键词对应基金";

  return (
    <section className="state-card">
      <p className="state-title">{title}</p>
      <p className="state-text">{text}</p>
      <button type="button" className="chip chip-muted clear-search-btn" onClick={onClear}>
        清空搜索
      </button>
    </section>
  );
}

function ErrorExample({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="state-card state-center">
      <AlertTriangle size={20} className="text-rise" />
      <p className="state-title">数据加载失败</p>
      <p className="state-text">请稍后重试</p>
      <button type="button" className="ghost-btn" onClick={onRetry}>
        立即重试
      </button>
    </section>
  );
}

function GroupTabBar({
  tabs,
  activeGroupId,
  onChange,
  onOpenManage
}: {
  tabs: GroupTabStat[];
  activeGroupId: GroupFilter;
  onChange: (groupId: GroupFilter) => void;
  onOpenManage: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <section className="group-tab-bar" aria-label="分组标签栏">
      <div className="group-tab-scroll">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn("group-tab-btn", activeGroupId === tab.id && "active")}
            onClick={() => onChange(tab.id)}
          >
            <span className="group-tab-name">{tab.name} {tab.fundCount}</span>
            <span
              className={cn(
                "group-tab-delta",
                deltaClass(tab.avgDeltaPercent) === "rise" && "text-rise",
                deltaClass(tab.avgDeltaPercent) === "fall" && "text-fall"
              )}
            >
              {formatPercent(tab.avgDeltaPercent)}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="group-manage-btn"
        onClick={(event) => onOpenManage(event.currentTarget)}
        aria-label="管理分组"
      >
        <Settings2 size={12} />
        <span className="group-manage-text">管理分组</span>
      </button>
    </section>
  );
}

function GroupPerformanceBar({
  summary
}: {
  summary: GroupPerformanceSummary | null;
}) {
  if (!summary) {
    return null;
  }

  return (
    <section className="group-performance-bar" aria-label="分组绩效看板">
      <div className="group-performance-meta">
        <p>{summary.groupName} · {summary.memberCount} 只</p>
        <span>口径：简单平均（忽略空值）</span>
      </div>
      <div className="group-performance-metrics">
        <div className="group-performance-item">
          <span>当日绩效</span>
          <strong
            className={cn(
              deltaClass(summary.todayAvgDeltaPct) === "rise" && "text-rise",
              deltaClass(summary.todayAvgDeltaPct) === "fall" && "text-fall"
            )}
          >
            {formatPercent(summary.todayAvgDeltaPct)}
          </strong>
        </div>
        <div className="group-performance-item">
          <span>近7天绩效</span>
          <strong
            className={cn(
              deltaClass(summary.sevenDayReturnPct) === "rise" && "text-rise",
              deltaClass(summary.sevenDayReturnPct) === "fall" && "text-fall"
            )}
          >
            {formatPercent(summary.sevenDayReturnPct)}
          </strong>
        </div>
      </div>
    </section>
  );
}

function formatNoteTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
}

function RealtimeNotesSidebar({
  focusedFund,
  items,
  loading,
  saving,
  noteInput,
  noteInputRef,
  onNoteInputChange,
  onAdd,
  onDelete,
  onOpenReviewEditor
}: {
  focusedFund: FundCardData | null;
  items: DecisionChecklistItem[];
  loading: boolean;
  saving: boolean;
  noteInput: string;
  noteInputRef?: RefObject<HTMLInputElement | null>;
  onNoteInputChange: (value: string) => void;
  onAdd: () => void;
  onDelete: (itemId: string) => void;
  onOpenReviewEditor: (fund: FundCardData, trigger: HTMLButtonElement) => void;
}) {
  if (!focusedFund) {
    return (
      <section className="decision-panel-empty panel-switch">
        <p>先选择一只基金，再记录盘中笔记</p>
      </section>
    );
  }

  return (
    <section className="decision-panel panel-switch">
      <header className="decision-head">
        <div>
          <h3>{focusedFund.code} · {focusedFund.name}</h3>
          <p>盘中速记（实时保存）</p>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={(event) => onOpenReviewEditor(focusedFund, event.currentTarget)}
        >
          打开复盘
        </button>
      </header>

      <section className="note-composer">
        <input
          ref={noteInputRef}
          className="modal-input"
          placeholder="输入实时笔记，按回车快速记录"
          value={noteInput}
          onChange={(event) => onNoteInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onAdd();
            }
          }}
        />
        <button type="button" className="add-fund-btn compact" onClick={onAdd} disabled={saving}>
          {saving ? "记录中..." : "记录"}
        </button>
      </section>

      <section className="decision-items">
        <h4>最近记录</h4>
        {loading ? <p className="modal-hint">加载中...</p> : null}
        {!loading && items.length === 0 ? <p className="modal-hint">暂无记录，可先写下盘中想法。</p> : null}
        {items.map((item) => {
          return (
            <article key={item.id} className="decision-item">
              <header>
                <strong>{item.triggerCondition}</strong>
                <span>{formatNoteTime(item.updatedAt)}</span>
              </header>
              <div className="decision-item-actions">
                <button type="button" className="danger-btn" onClick={() => onDelete(item.id)}>
                  删除
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}

function FundCard({
  fund,
  expanded,
  historyRange,
  historyState,
  historyAnalysis,
  historyStartDate,
  historyEndDate,
  historyError,
  maskAmounts,
  positionSaving,
  compact,
  isSelecting,
  isSelected,
  focused,
  onDelete,
  onToggleSelect,
  onFocus,
  onOpenPositionEditor,
  onOpenGroupEditor,
  onOpenReviewEditor,
  onToggleHistory,
  onChangeHistoryRange,
  onRetryHistory
}: {
  fund: FundCardData;
  expanded: boolean;
  historyRange: HistoryRange;
  historyState?: HistoryLoadingState;
  historyAnalysis?: FundHistoryAnalysis;
  historyStartDate?: string | null;
  historyEndDate?: string | null;
  historyError?: string | null;
  maskAmounts: boolean;
  positionSaving?: boolean;
  compact?: boolean;
  isSelecting: boolean;
  isSelected: boolean;
  focused: boolean;
  onDelete: (code: string, trigger: HTMLElement) => void;
  onToggleSelect: (code: string) => void;
  onFocus: (code: string) => void;
  onOpenPositionEditor: (fund: FundCardData, trigger: HTMLButtonElement) => void;
  onOpenGroupEditor: (fund: FundCardData, trigger: HTMLButtonElement) => void;
  onOpenReviewEditor: (fund: FundCardData, trigger: HTMLButtonElement) => void;
  onToggleHistory: (code: string) => void;
  onChangeHistoryRange: (code: string, range: HistoryRange) => void;
  onRetryHistory: (code: string) => void;
}) {
  const delta = deltaClass(fund.deltaPercent);
  const axis = trendAxisLabel();
  const panelState = historyState ?? "loading";
  const historyStartLabel = formatHistoryAxisDate(historyStartDate ?? null, historyRange);
  const historyEndLabel = formatHistoryAxisDate(historyEndDate ?? null, historyRange);
  const position = fund.position;
  const metrics = fund.positionMetrics;
  const visibleGroups = fund.groups.slice(0, 2);
  const overflowCount = Math.max(fund.groups.length - visibleGroups.length, 0);

  return (
    <article
      className={cn(
        "fund-card",
        compact && "fund-card-compact",
        isSelecting && isSelected && "fund-card-selected",
        focused && "fund-card-focused"
      )}
      onClick={() => onFocus(fund.code)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus(fund.code);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      data-fund-code={fund.code}
    >
      <div className="card-top">
        <div className="card-info">
          <div className="card-title-row">
            {isSelecting ? (
              <button
                type="button"
                className="select-toggle"
                onClick={() => onToggleSelect(fund.code)}
                aria-label={`${isSelected ? "取消选择" : "选择"}基金 ${fund.code}`}
              >
                {isSelected ? <CheckSquare2 size={14} /> : <Square size={14} />}
              </button>
            ) : null}
            <ChartNoAxesCombined size={16} className="text-accent" />
            <h2>{fund.name}</h2>
          </div>
          <p className="fund-code">基金代码: {fund.code}</p>
          <div className="group-chip-row">
            <span className="group-chip-icon"><Folders size={11} /></span>
            {visibleGroups.length > 0 ? (
              visibleGroups.map((group) => (
                <span key={group.groupId} className="group-chip">
                  {group.groupName}
                </span>
              ))
            ) : (
              <span className="group-chip group-chip-empty">未分组</span>
            )}
            {overflowCount > 0 ? <span className="group-chip-overflow">+{overflowCount} 组</span> : null}
          </div>
          <button
            type="button"
            className="group-edit-btn"
            onClick={(event) => onOpenGroupEditor(fund, event.currentTarget)}
            aria-label={`编辑 ${fund.code} 分组`}
          >
            <FolderCog size={11} />
            编辑分组
          </button>
        </div>
        {isSelecting ? null : (
          <button
            className="delete-btn"
            type="button"
            onClick={(event) => onDelete(fund.code, event.currentTarget)}
            aria-label={`删除基金 ${fund.code}`}
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>

      <div className="metrics-row">
        <div className="metric-item">
          <span>单位净值</span>
          <strong>{maskMoney(formatNumber(fund.nav), maskAmounts)}</strong>
        </div>
        <div className="metric-item">
          <span>估算净值</span>
          <strong className={cn(delta === "rise" && "text-rise", delta === "fall" && "text-fall")}>
            {maskMoney(formatNumber(fund.estimatedNav), maskAmounts)}
          </strong>
        </div>
        <div className="metric-item">
          <span>涨跌</span>
          <div className={cn("chip", delta === "rise" && "chip-rise", delta === "fall" && "chip-fall")}> 
            {maskMoney(formatNumber(fund.deltaValue), maskAmounts)}({formatPercent(fund.deltaPercent)})
          </div>
        </div>
      </div>

      <div className="card-quick-actions">
        <button
          type="button"
          className="quick-action-btn"
          onClick={(event) => {
            event.stopPropagation();
            onOpenPositionEditor(fund, event.currentTarget);
          }}
        >
          持仓
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={(event) => {
            event.stopPropagation();
            onOpenGroupEditor(fund, event.currentTarget);
          }}
        >
          分组
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={(event) => {
            event.stopPropagation();
            onOpenReviewEditor(fund, event.currentTarget);
          }}
        >
          复盘
        </button>
        {compact ? (
          <button
            type="button"
            className={cn("quick-action-btn", expanded && "active")}
            onClick={(event) => {
              event.stopPropagation();
              onToggleHistory(fund.code);
            }}
            aria-expanded={expanded}
            aria-controls={`history-panel-${fund.code}`}
          >
            历史
          </button>
        ) : null}
      </div>

      {!compact && metrics.hasPosition ? (
        <section className="position-block">
          <div className="position-head">
            <div className="position-title-wrap">
              <Wallet size={14} className="text-accent" />
              <span>持仓概览</span>
            </div>
            <button
              type="button"
              className="position-edit-btn"
              onClick={(event) => onOpenPositionEditor(fund, event.currentTarget)}
              aria-label={`编辑${fund.code}持仓`}
              disabled={positionSaving}
            >
              {positionSaving ? "保存中..." : "编辑持仓"}
            </button>
          </div>

          <div className="position-grid">
            <div className="position-item">
              <span>持有份额</span>
              <strong>{formatShares(position?.shares ?? null)}</strong>
            </div>
            <div className="position-item">
              <span>持仓成本</span>
              <strong>{maskMoney(formatCurrency(position?.costPerUnit ?? null), maskAmounts)}</strong>
            </div>
            <div className="position-item">
              <span>持仓市值</span>
              <strong>{maskMoney(formatCurrency(metrics.marketValue), maskAmounts)}</strong>
            </div>
          </div>

          <div className="position-pnl-row">
            <div
              className={cn(
                "position-chip",
                deltaClass(metrics.totalPnl) === "rise" && "chip-rise",
                deltaClass(metrics.totalPnl) === "fall" && "chip-fall"
              )}
            >
              累计盈亏 {maskMoney(formatCurrency(metrics.totalPnl), maskAmounts)} ({formatPercent(metrics.totalPnlPct)})
            </div>
            <div
              className={cn(
                "position-chip",
                deltaClass(metrics.dailyPnl) === "rise" && "chip-rise",
                deltaClass(metrics.dailyPnl) === "fall" && "chip-fall"
              )}
            >
              当日盈亏 {maskMoney(formatCurrency(metrics.dailyPnl), maskAmounts)}
            </div>
          </div>
        </section>
      ) : !compact ? (
        <section className="position-empty-block">
          <Wallet size={14} className="text-muted" />
          <p>尚未录入持仓，无法计算你的盈亏</p>
          <button
            type="button"
            className="position-add-btn"
            onClick={(event) => onOpenPositionEditor(fund, event.currentTarget)}
            disabled={positionSaving}
          >
            录入持仓
          </button>
        </section>
      ) : null}

      <div className="time-row">
        <Calendar size={14} className="text-muted" />
        <span>{fund.asOfDate ?? "--"}</span>
        <Clock3 size={14} className="text-muted" />
        <span>{fund.asOfTime ?? "--"}</span>
        {fund.stale ? (
          <>
            <span className="stale-dot">数据可能延迟</span>
            <span className="stale-detail">以上次快照为准</span>
          </>
        ) : null}
      </div>

      <div className="sparkline-shell">
        <Sparkline points={fund.trendPoints} maskAmounts={maskAmounts} />
        <div className="axis-with-ticks">
          <div className="tick-row" aria-hidden="true">
            {intradayAxisTicks.map((tick) => (
              <span key={`tick-${tick}`} className="tick-line" />
            ))}
          </div>
          <div className="label-row">
            <span>{axis.start}</span>
            <span>10:30</span>
            <span>11:30</span>
            <span>14:00</span>
            <span>{axis.end}</span>
          </div>
        </div>
      </div>

      {!compact ? (
        <section className="review-summary">
          <div className="review-summary-head">
            <span className="review-summary-title">
              <ClipboardList size={13} />
              复盘笔记
            </span>
            <button
              type="button"
              className="review-edit-btn"
              onClick={(event) => onOpenReviewEditor(fund, event.currentTarget)}
            >
              {fund.latestReview ? "编辑复盘" : "新增复盘"}
            </button>
          </div>
          <p className="review-summary-body">{formatReviewSummary(fund.latestReview)}</p>
        </section>
      ) : null}

      {!compact ? (
        <button
        type="button"
        className={cn("history-toggle", expanded && "active")}
        onClick={() => onToggleHistory(fund.code)}
        aria-expanded={expanded}
        aria-controls={`history-panel-${fund.code}`}
      >
        <span className="history-toggle-left">
          <ChartNoAxesCombined size={14} className="text-accent" />
          <span>历史分析</span>
        </span>
        <span className="history-toggle-right">
          <span className="history-subtitle">{formatHistoryRangeLabel(historyRange)}</span>
          {expanded ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </span>
      </button>
      ) : null}

      {expanded ? (
        <section
          id={`history-panel-${fund.code}`}
          className={cn("history-panel", compact && "history-panel-compact")}
        >
          <div className="history-head">
            <div className="history-title-wrap">
              <ChartNoAxesCombined size={14} className="text-accent" />
              <span>历史分析</span>
            </div>
            <span className="history-head-sub">{formatHistoryRangeLabel(historyRange)}</span>
          </div>

          <div className="history-range-segment" role="tablist" aria-label="历史区间切换">
            {historyRanges.map((range) => (
              <button
                key={range}
                type="button"
                className={cn("history-range-btn", historyRange === range && "active")}
                onClick={() => onChangeHistoryRange(fund.code, range)}
              >
                {range}
              </button>
            ))}
          </div>

          {panelState === "loading" ? (
            <div className="history-state history-loading">
              <LoaderCircle size={14} className="spin-icon" />
              <span>历史数据加载中...</span>
            </div>
          ) : null}

          {panelState === "error" ? (
            <div className="history-state history-error">
              <AlertTriangle size={14} />
              <span>{historyError || "历史数据加载失败"}</span>
              <button type="button" className="ghost-btn" onClick={() => onRetryHistory(fund.code)}>
                重试
              </button>
            </div>
          ) : null}

          {panelState === "empty" ? (
            <div className="history-state history-empty">
              <Inbox size={14} className="text-muted" />
              <span>该区间暂无历史净值数据</span>
            </div>
          ) : null}

          {panelState === "ready" && historyAnalysis ? (
            <>
              <div className="history-chart-shell">
                <HistoryLineChart points={historyAnalysis.points} maskAmounts={maskAmounts} />
                <div className="axis-row history-axis-row">
                  <span>{historyStartLabel}</span>
                  <span>{historyEndLabel}</span>
                </div>
              </div>

              <div className="history-metric-card">
                <p
                  className={cn(
                    "history-metric-main",
                    deltaClass(historyAnalysis.returnPct) === "rise" && "text-rise",
                    deltaClass(historyAnalysis.returnPct) === "fall" && "text-fall"
                  )}
                >
                  区间收益 {formatPercent(historyAnalysis.returnPct)}
                </p>
                <p
                  className={cn(
                    "history-metric-main",
                    deltaClass(historyAnalysis.maxDrawdownPct) === "rise" && "text-rise",
                    deltaClass(historyAnalysis.maxDrawdownPct) === "fall" && "text-fall"
                  )}
                >
                  最大回撤 {formatPercent(historyAnalysis.maxDrawdownPct)}
                </p>
                <p className="history-metric-sub">
                  区间高点 {maskMoney(formatNumber(historyAnalysis.periodHigh?.nav ?? null), maskAmounts)}（
                  {formatDateOnly(historyAnalysis.periodHigh?.ts ?? null)}）
                </p>
                <p className="history-metric-sub">
                  区间低点 {maskMoney(formatNumber(historyAnalysis.periodLow?.nav ?? null), maskAmounts)}（
                  {formatDateOnly(historyAnalysis.periodLow?.ts ?? null)}）
                </p>
              </div>

              <p className="history-updated">
                历史数据更新时间：{formatLastUpdatedAt(historyAnalysis.updatedAt)} · fromCache=
                {String(historyAnalysis.fromCache)}
              </p>
            </>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [groups, setGroups] = useState<FundGroup[]>([]);
  const [groupTabs, setGroupTabs] = useState<GroupTabStat[]>([]);
  const [groupPerformance, setGroupPerformance] = useState<GroupPerformanceSummary | null>(null);
  const [funds, setFunds] = useState<FundCardData[]>([]);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<"intraday" | "review">("intraday");
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isGroupManageOpen, setIsGroupManageOpen] = useState(false);
  const [editingGroupFundCode, setEditingGroupFundCode] = useState<string | null>(null);
  const [groupEditSelection, setGroupEditSelection] = useState<string[]>([]);
  const [groupEditSaving, setGroupEditSaving] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newFundGroupIds, setNewFundGroupIds] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState("");
  const [groupManageSaving, setGroupManageSaving] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [batchActionLoading, setBatchActionLoading] = useState<"idle" | "applyGroup" | "delete">("idle");
  const [isBatchGroupOpen, setIsBatchGroupOpen] = useState(false);
  const [batchGroupSelection, setBatchGroupSelection] = useState<string[]>([]);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
  const [editingPositionFundCode, setEditingPositionFundCode] = useState<string | null>(null);
  const [positionFormShares, setPositionFormShares] = useState("");
  const [positionFormCostPerUnit, setPositionFormCostPerUnit] = useState("");
  const [positionSavingByFund, setPositionSavingByFund] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [maskAmounts, setMaskAmounts] = useState(false);
  const [expandedFundCode, setExpandedFundCode] = useState<string | undefined>(undefined);
  const [historyRangeByFund, setHistoryRangeByFund] = useState<Record<string, HistoryRange>>({});
  const [historyStateByFund, setHistoryStateByFund] = useState<Record<string, HistoryLoadingState>>({});
  const [historyCacheByFund, setHistoryCacheByFund] = useState<HistoryCache>({});
  const [historyErrorByFund, setHistoryErrorByFund] = useState<Record<string, string | null>>({});
  const [editingReviewFundCode, setEditingReviewFundCode] = useState<string | null>(null);
  const [reviewNotesByFund, setReviewNotesByFund] = useState<Record<string, FundReviewNote[]>>({});
  const [reviewLoadingByFund, setReviewLoadingByFund] = useState<Record<string, boolean>>({});
  const [reviewSavingByFund, setReviewSavingByFund] = useState<Record<string, boolean>>({});
  const [reviewSelectedIdByFund, setReviewSelectedIdByFund] = useState<Record<string, string | null>>({});
  const [reviewListQueryByFund, setReviewListQueryByFund] = useState<Record<string, string>>({});
  const [reviewDraftDirty, setReviewDraftDirty] = useState(false);
  const [reviewMobilePane, setReviewMobilePane] = useState<"list" | "editor">("list");
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [reviewFormTitle, setReviewFormTitle] = useState("");
  const [reviewFormDate, setReviewFormDate] = useState("");
  const [reviewFormExpectation, setReviewFormExpectation] = useState("");
  const [reviewFormResult, setReviewFormResult] = useState("");
  const [reviewFormReason, setReviewFormReason] = useState("");
  const [reviewFormActionPlan, setReviewFormActionPlan] = useState("");
  const [reviewFormTags, setReviewFormTags] = useState("");
  const [checklistByFund, setChecklistByFund] = useState<Record<string, DecisionChecklistItem[]>>({});
  const [checklistLoadingByFund, setChecklistLoadingByFund] = useState<Record<string, boolean>>({});
  const [checklistSavingByFund, setChecklistSavingByFund] = useState<Record<string, boolean>>({});
  const [realtimeNoteInput, setRealtimeNoteInput] = useState("");

  const latestRequestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const hasDataRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<Record<string, AbortController>>({});
  const historyRequestIdRef = useRef<Record<string, number>>({});
  const historyRangeRef = useRef<Record<string, HistoryRange>>({});
  const historyCacheRef = useRef<HistoryCache>({});
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const desktopSearchRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchRef = useRef<HTMLInputElement | null>(null);
  const noteInputRef = useRef<HTMLInputElement | null>(null);
  const addModalRef = useRef<HTMLElement | null>(null);
  const deleteModalRef = useRef<HTMLElement | null>(null);
  const positionModalRef = useRef<HTMLElement | null>(null);
  const groupManageModalRef = useRef<HTMLElement | null>(null);
  const groupEditModalRef = useRef<HTMLElement | null>(null);
  const batchGroupModalRef = useRef<HTMLElement | null>(null);
  const batchDeleteModalRef = useRef<HTMLElement | null>(null);
  const reviewModalRef = useRef<HTMLElement | null>(null);

  const confirmDiscardReviewDraft = useCallback((): boolean => {
    if (!reviewDraftDirty) {
      return true;
    }
    return window.confirm("当前笔记有未保存修改，确认放弃吗？");
  }, [reviewDraftDirty]);

  const closeReviewWorkspace = useCallback((): boolean => {
    if (!confirmDiscardReviewDraft()) {
      return false;
    }
    setEditingReviewFundCode(null);
    setReviewMobilePane("list");
    return true;
  }, [confirmDiscardReviewDraft]);

  const showToast = useCallback((tone: ToastState["tone"], message: string) => {
    setToast({
      id: Date.now(),
      tone,
      message
    });
  }, []);

  useEffect(() => {
    hasDataRef.current = funds.length > 0;
  }, [funds.length]);

  useEffect(() => {
    if (!isSelecting) {
      return;
    }
    const fundSet = new Set(funds.map((fund) => fund.code));
    setSelectedCodes((prev) => prev.filter((code) => fundSet.has(code)));
  }, [funds, isSelecting]);

  useEffect(() => {
    historyRangeRef.current = historyRangeByFund;
  }, [historyRangeByFund]);

  useEffect(() => {
    historyCacheRef.current = historyCacheByFund;
  }, [historyCacheByFund]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2400);

    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("mask-amounts");
      if (saved === "1") {
        setMaskAmounts(true);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("mask-amounts", maskAmounts ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [maskAmounts]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      setQuery(queryInput);
    }, 220);

    return () => {
      clearTimeout(debounce);
    };
  }, [queryInput]);

  const fetchFunds = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;

      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      if (options.showLoading) {
        setLoadingState("loading");
      }
      setIsRefreshing(true);

      try {
        const response = await fetch(
          `/api/v1/funds?workspace=intraday&query=${encodeURIComponent(query)}&sortBy=${sortBy}&groupId=${encodeURIComponent(String(groupFilter))}`,
          {
            cache: "no-store",
            signal: controller.signal
          }
        );

        let payload: FundsResponse | ApiErrorResponse;
        try {
          payload = (await response.json()) as FundsResponse | ApiErrorResponse;
        } catch {
          payload = {};
        }

        if (!response.ok) {
          const backendMessage =
            (payload as ApiErrorResponse).message ??
            (payload as ApiErrorResponse).error ??
            "基金数据加载失败";
          throw new Error(backendMessage);
        }

        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        const successPayload = payload as FundsResponse;
        setFunds(successPayload.funds);
        setLoadingState(successPayload.loadingState);
        setLastUpdatedAt(successPayload.lastUpdatedAt);
        setGroups(successPayload.groups ?? []);
        setGroupTabs(successPayload.groupTabs ?? []);
        setGroupPerformance(successPayload.groupPerformance ?? null);
        if ((successPayload.groupTabs ?? []).every((tab) => tab.id !== groupFilter)) {
          setGroupFilter("all");
        }
        setFocusedCode((previous) => {
          if (previous && successPayload.funds.some((fund) => fund.code === previous)) {
            return previous;
          }
          return successPayload.focusedCode ?? successPayload.funds[0]?.code ?? null;
        });
        setErrorMessage(null);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        const message = classifyFetchFailure(error);
        if (message.length > 0) {
          setErrorMessage(message);
        }

        if (!hasDataRef.current) {
          setLoadingState("error");
        } else {
          setLoadingState("idle");
        }
      } finally {
        if (requestId === latestRequestIdRef.current) {
          setIsRefreshing(false);
        }
        if (fetchAbortRef.current === controller) {
          fetchAbortRef.current = null;
        }
      }
    },
    [groupFilter, query, sortBy]
  );

  useEffect(() => {
    const showLoading = !hasLoadedRef.current;
    void fetchFunds({ showLoading });
    hasLoadedRef.current = true;
  }, [fetchFunds]);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchFunds();
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [fetchFunds]);

  useEffect(() => {
    const historyAbortMap = historyAbortRef.current;
    return () => {
      fetchAbortRef.current?.abort();
      Object.values(historyAbortMap).forEach((controller) => controller.abort());
    };
  }, []);

  useEffect(() => {
    if (!expandedFundCode) {
      return;
    }

    const exists = funds.some((fund) => fund.code === expandedFundCode);
    if (!exists) {
      setExpandedFundCode(undefined);
    }
  }, [expandedFundCode, funds]);

  useEffect(() => {
    const activeModal = isAddOpen
      ? addModalRef.current
      : pendingDeleteCode
        ? deleteModalRef.current
        : isBatchDeleteOpen
          ? batchDeleteModalRef.current
          : isBatchGroupOpen
            ? batchGroupModalRef.current
        : editingPositionFundCode
          ? positionModalRef.current
          : isGroupManageOpen
            ? groupManageModalRef.current
            : editingGroupFundCode
              ? groupEditModalRef.current
              : editingReviewFundCode
                ? reviewModalRef.current
              : null;
    if (!activeModal) {
      return;
    }

    const focusable = activeModal.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isAddOpen) {
          setIsAddOpen(false);
        }
        if (pendingDeleteCode) {
          setPendingDeleteCode(null);
        }
        if (isBatchDeleteOpen) {
          setIsBatchDeleteOpen(false);
        }
        if (isBatchGroupOpen) {
          setIsBatchGroupOpen(false);
        }
        if (editingPositionFundCode) {
          setEditingPositionFundCode(null);
        }
        if (isGroupManageOpen) {
          setIsGroupManageOpen(false);
        }
        if (editingGroupFundCode) {
          setEditingGroupFundCode(null);
        }
        if (editingReviewFundCode) {
          closeReviewWorkspace();
        }
        return;
      }

      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    editingGroupFundCode,
    editingPositionFundCode,
    closeReviewWorkspace,
    editingReviewFundCode,
    isAddOpen,
    isBatchDeleteOpen,
    isBatchGroupOpen,
    isGroupManageOpen,
    pendingDeleteCode
  ]);

  useEffect(() => {
    if (
      isAddOpen ||
      pendingDeleteCode ||
      isBatchDeleteOpen ||
      isBatchGroupOpen ||
      editingPositionFundCode ||
      isGroupManageOpen ||
      editingGroupFundCode ||
      editingReviewFundCode
    ) {
      return;
    }

    if (lastFocusRef.current) {
      lastFocusRef.current.focus();
      lastFocusRef.current = null;
    }
  }, [
    editingGroupFundCode,
    editingPositionFundCode,
    editingReviewFundCode,
    isAddOpen,
    isBatchDeleteOpen,
    isBatchGroupOpen,
    isGroupManageOpen,
    pendingDeleteCode
  ]);

  const moveFocusedFund = useCallback(
    (offset: number) => {
      if (funds.length === 0) {
        return;
      }
      const currentIndex = focusedCode ? funds.findIndex((fund) => fund.code === focusedCode) : -1;
      const nextIndex = Math.min(funds.length - 1, Math.max(0, currentIndex + offset));
      const nextFund = funds[nextIndex];
      if (!nextFund) {
        return;
      }
      setFocusedCode(nextFund.code);
      const node = document.querySelector<HTMLElement>(`[data-fund-code="${nextFund.code}"]`);
      node?.focus();
    },
    [focusedCode, funds]
  );

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName ?? "";
      const isEditable =
        target?.isContentEditable ||
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT";
      if (isEditable) {
        return;
      }

      const hasModalOpen =
        isAddOpen ||
        Boolean(pendingDeleteCode) ||
        isBatchDeleteOpen ||
        isBatchGroupOpen ||
        Boolean(editingPositionFundCode) ||
        isGroupManageOpen ||
        Boolean(editingGroupFundCode) ||
        Boolean(editingReviewFundCode);
      if (hasModalOpen) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        moveFocusedFund(1);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        moveFocusedFund(-1);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && focusedCode && !isSelecting) {
        event.preventDefault();
        lastFocusRef.current = (target ?? document.body) as HTMLElement;
        setPendingDeleteCode(focusedCode);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        const searchInput = window.innerWidth <= 900 ? mobileSearchRef.current : desktopSearchRef.current;
        searchInput?.focus();
        return;
      }
      if ((event.key === "n" || event.key === "N") && focusedCode) {
        event.preventDefault();
        noteInputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
    };
  }, [
    editingGroupFundCode,
    editingPositionFundCode,
    editingReviewFundCode,
    focusedCode,
    isAddOpen,
    isBatchDeleteOpen,
    isBatchGroupOpen,
    isGroupManageOpen,
    isSelecting,
    moveFocusedFund,
    pendingDeleteCode
  ]);

  const onOpenAddModal = useCallback((trigger: HTMLElement) => {
    lastFocusRef.current = trigger;
    setIsAddOpen(true);
    setNewFundGroupIds([]);
  }, []);

  const onOpenDeleteModal = useCallback((code: string, trigger: HTMLElement) => {
    lastFocusRef.current = trigger;
    setPendingDeleteCode(code);
  }, []);

  const onOpenPositionEditor = useCallback((fund: FundCardData, trigger: HTMLButtonElement) => {
    lastFocusRef.current = trigger;
    setEditingPositionFundCode(fund.code);
    setPositionFormShares(
      fund.position?.shares !== undefined
        ? fund.position.shares.toLocaleString("en-US", {
            useGrouping: false,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })
        : ""
    );
    setPositionFormCostPerUnit(
      fund.position?.costPerUnit !== undefined
        ? fund.position.costPerUnit.toLocaleString("en-US", {
            useGrouping: false,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })
        : ""
    );
  }, []);

  const onOpenGroupManage = useCallback((trigger: HTMLButtonElement) => {
    lastFocusRef.current = trigger;
    setIsGroupManageOpen(true);
    setRenameGroupId(null);
    setRenameGroupValue("");
  }, []);

  const onOpenGroupEditor = useCallback((fund: FundCardData, trigger: HTMLButtonElement) => {
    lastFocusRef.current = trigger;
    setEditingGroupFundCode(fund.code);
    setGroupEditSelection(fund.groups.map((group) => group.groupId));
  }, []);

  const onClearSearch = useCallback(() => {
    setQueryInput("");
    setQuery("");
  }, []);

  const onToggleSelectFund = useCallback((code: string) => {
    setSelectedCodes((prev) => (prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]));
  }, []);

  const onStartSelect = useCallback(() => {
    setIsSelecting(true);
    setSelectedCodes([]);
  }, []);

  const onCancelSelect = useCallback(() => {
    setIsSelecting(false);
    setSelectedCodes([]);
    setBatchActionLoading("idle");
  }, []);

  const parseTagInput = useCallback((value: string): string[] => {
    return value
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter((item, index, arr) => item.length > 0 && arr.indexOf(item) === index);
  }, []);

  const resetReviewForm = useCallback((note?: FundReviewNote | null) => {
    if (note) {
      setEditingReviewId(note.id);
      setReviewFormTitle(note.title);
      setReviewFormDate(note.reviewDate);
      setReviewFormExpectation(note.expectation);
      setReviewFormResult(note.result);
      setReviewFormReason(note.reason);
      setReviewFormActionPlan(note.actionPlan);
      setReviewFormTags(note.tags.join(","));
      setReviewDraftDirty(false);
      return;
    }
    setEditingReviewId(null);
    setReviewFormTitle("");
    setReviewFormDate(new Date().toISOString().slice(0, 10));
    setReviewFormExpectation("");
    setReviewFormResult("");
    setReviewFormReason("");
    setReviewFormActionPlan("");
    setReviewFormTags("");
    setReviewDraftDirty(false);
  }, []);

  const loadFundReviews = useCallback(async (code: string) => {
    setReviewLoadingByFund((prev) => ({ ...prev, [code]: true }));
    try {
      const response = await fetch(`/api/v1/funds/${code}/reviews`, { cache: "no-store" });
      const payload = (await response.json()) as ReviewListResponse | ApiErrorResponse;
      if (!response.ok) {
        throw new Error((payload as ApiErrorResponse).error ?? "加载复盘失败");
      }
      const notes = (payload as ReviewListResponse).notes ?? [];
      setReviewNotesByFund((prev) => ({ ...prev, [code]: notes }));
    } catch (error) {
      const message = classifyFetchFailure(error) || "加载复盘失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setReviewLoadingByFund((prev) => ({ ...prev, [code]: false }));
    }
  }, [showToast]);

  const onOpenReviewEditor = useCallback(
    (fund: FundCardData, trigger: HTMLButtonElement) => {
      lastFocusRef.current = trigger;
      setEditingReviewFundCode(fund.code);
      const preferredId = reviewSelectedIdByFund[fund.code] ?? fund.latestReview?.id ?? null;
      const cachedNotes = reviewNotesByFund[fund.code] ?? [];
      const preferredNote = preferredId ? cachedNotes.find((note) => note.id === preferredId) : null;
      setReviewSelectedIdByFund((prev) => ({ ...prev, [fund.code]: preferredId }));
      setReviewListQueryByFund((prev) => ({ ...prev, [fund.code]: prev[fund.code] ?? "" }));
      setReviewMobilePane(window.innerWidth <= 900 ? "list" : "editor");
      resetReviewForm(preferredNote ?? fund.latestReview);
      void loadFundReviews(fund.code);
    },
    [loadFundReviews, resetReviewForm, reviewNotesByFund, reviewSelectedIdByFund]
  );

  const loadChecklist = useCallback(async (code: string, date = getTodayShanghaiDateString()) => {
    setChecklistLoadingByFund((prev) => ({ ...prev, [code]: true }));
    try {
      const response = await fetch(`/api/v1/funds/${code}/checklist?date=${date}`, { cache: "no-store" });
      const payload = (await response.json()) as ChecklistResponse | ApiErrorResponse;
      if (!response.ok) {
        throw new Error((payload as ApiErrorResponse).error ?? "加载执行清单失败");
      }
      setChecklistByFund((prev) => ({ ...prev, [code]: (payload as ChecklistResponse).items ?? [] }));
    } catch (error) {
      const message = classifyFetchFailure(error) || "加载执行清单失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setChecklistLoadingByFund((prev) => ({ ...prev, [code]: false }));
    }
  }, [showToast]);

  useEffect(() => {
    if (!focusedCode) {
      return;
    }
    void loadChecklist(focusedCode);
  }, [focusedCode, loadChecklist]);

  useEffect(() => {
    setRealtimeNoteInput("");
  }, [focusedCode]);

  const onSavePosition = useCallback(async () => {
    const code = editingPositionFundCode;
    if (!code) {
      return;
    }

    const shares = Number(positionFormShares.trim());
    const costPerUnit = Number(positionFormCostPerUnit.trim());
    if (!Number.isFinite(shares) || shares <= 0) {
      const message = "持有份额必须大于 0";
      setErrorMessage(message);
      showToast("error", message);
      return;
    }

    if (!Number.isFinite(costPerUnit) || costPerUnit <= 0) {
      const message = "单位持仓成本必须大于 0";
      setErrorMessage(message);
      showToast("error", message);
      return;
    }

    setPositionSavingByFund((prev) => ({ ...prev, [code]: true }));
    try {
      const response = await fetch(`/api/v1/funds/${code}/position`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shares, costPerUnit })
      });
      const payload = (await response.json()) as PositionResponse | ApiErrorResponse;
      if (!response.ok) {
        throw new Error((payload as ApiErrorResponse).error ?? "保存持仓失败");
      }

      setEditingPositionFundCode(null);
      setErrorMessage(null);
      showToast("success", "持仓已保存");
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "保存持仓失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setPositionSavingByFund((prev) => ({ ...prev, [code]: false }));
    }
  }, [editingPositionFundCode, fetchFunds, positionFormCostPerUnit, positionFormShares, showToast]);

  const onClearPosition = useCallback(async () => {
    const code = editingPositionFundCode;
    if (!code) {
      return;
    }

    setPositionSavingByFund((prev) => ({ ...prev, [code]: true }));
    try {
      const response = await fetch(`/api/v1/funds/${code}/position`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "清空持仓失败");
      }

      setEditingPositionFundCode(null);
      setErrorMessage(null);
      showToast("info", "持仓已清空");
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "清空持仓失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setPositionSavingByFund((prev) => ({ ...prev, [code]: false }));
    }
  }, [editingPositionFundCode, fetchFunds, showToast]);

  const loadHistory = useCallback(
    async (code: string, range: HistoryRange, options: { force?: boolean } = {}) => {
      const cached = historyCacheRef.current[code]?.[range];
      if (cached && !options.force) {
        setHistoryStateByFund((prev) => ({
          ...prev,
          [code]: cached.analysis.points.length > 0 ? "ready" : "empty"
        }));
        setHistoryErrorByFund((prev) => ({ ...prev, [code]: null }));
        return;
      }

      const requestId = (historyRequestIdRef.current[code] ?? 0) + 1;
      historyRequestIdRef.current[code] = requestId;

      historyAbortRef.current[code]?.abort();
      const controller = new AbortController();
      historyAbortRef.current[code] = controller;

      setHistoryStateByFund((prev) => ({ ...prev, [code]: "loading" }));
      setHistoryErrorByFund((prev) => ({ ...prev, [code]: null }));

      try {
        const response = await fetch(`/api/v1/funds/${code}/history?range=${range}`, {
          cache: "no-store",
          signal: controller.signal
        });

        const payload = (await response.json()) as HistoryResponse | ApiErrorResponse;
        if (!response.ok) {
          throw new Error(
            (payload as ApiErrorResponse).message ??
              (payload as ApiErrorResponse).error ??
              "历史数据加载失败"
          );
        }

        if (historyRequestIdRef.current[code] !== requestId) {
          return;
        }

        const historyPayload = payload as HistoryResponse;
        setHistoryCacheByFund((prev) => {
          const next = {
            ...prev,
            [code]: {
              ...(prev[code] ?? {}),
              [range]: {
                startDate: historyPayload.startDate,
                endDate: historyPayload.endDate,
                analysis: historyPayload.analysis
              }
            }
          };
          historyCacheRef.current = next;
          return next;
        });
        setHistoryStateByFund((prev) => ({
          ...prev,
          [code]: historyPayload.analysis.points.length > 0 ? "ready" : "empty"
        }));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        if (historyRequestIdRef.current[code] !== requestId) {
          return;
        }
        setHistoryStateByFund((prev) => ({ ...prev, [code]: "error" }));
        setHistoryErrorByFund((prev) => ({
          ...prev,
          [code]: classifyFetchFailure(error) || "历史数据加载失败"
        }));
      } finally {
        if (historyAbortRef.current[code] === controller) {
          delete historyAbortRef.current[code];
        }
      }
    },
    []
  );

  const onToggleHistory = useCallback(
    (code: string) => {
      setExpandedFundCode((prev) => {
        if (prev === code) {
          return undefined;
        }

        const range = historyRangeRef.current[code] ?? DEFAULT_HISTORY_RANGE;
        setHistoryRangeByFund((map) => ({ ...map, [code]: range }));
        void loadHistory(code, range);
        return code;
      });
    },
    [loadHistory]
  );

  const onChangeHistoryRange = useCallback(
    (code: string, range: HistoryRange) => {
      setHistoryRangeByFund((prev) => ({ ...prev, [code]: range }));
      void loadHistory(code, range);
    },
    [loadHistory]
  );

  const onRetryHistory = useCallback(
    (code: string) => {
      const range = historyRangeRef.current[code] ?? DEFAULT_HISTORY_RANGE;
      void loadHistory(code, range, { force: true });
    },
    [loadHistory]
  );

  const onAddFund = useCallback(async () => {
    const code = newCode.trim();
    if (!/^\d{6}$/.test(code)) {
      const message = "基金代码必须为 6 位数字";
      setErrorMessage(message);
      showToast("error", message);
      return;
    }

    try {
      const response = await fetch("/api/v1/funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, groupIds: newFundGroupIds })
      });
      const payload = (await response.json()) as {
        error?: string;
        item?: { code: string };
        created?: boolean;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "添加失败");
      }

      setIsAddOpen(false);
      setNewCode("");
      setNewName("");
      setNewFundGroupIds([]);
      setErrorMessage(null);

      if (payload.created === false) {
        showToast("info", `基金 ${payload.item?.code ?? code} 已在自选列表`);
      } else {
        showToast("success", `已添加基金 ${payload.item?.code ?? code}`);
      }

      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "添加失败";
      setErrorMessage(message);
      showToast("error", message);
    }
  }, [fetchFunds, newCode, newFundGroupIds, showToast]);

  const confirmDeleteFund = useCallback(async () => {
    if (!pendingDeleteCode) {
      return;
    }

    const deletingCode = pendingDeleteCode;
    try {
      const response = await fetch(`/api/v1/funds/${deletingCode}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "删除失败，请稍后重试");
      }

      setPendingDeleteCode(null);
      setErrorMessage(null);
      showToast("success", `已删除基金 ${deletingCode}`);
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "删除失败，请稍后重试";
      setErrorMessage(message);
      showToast("error", message);
    }
  }, [fetchFunds, pendingDeleteCode, showToast]);

  const onCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (name.length === 0) {
      showToast("error", "分组名称不能为空");
      return;
    }

    setGroupManageSaving(true);
    try {
      const response = await fetch("/api/v1/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = (await response.json()) as GroupResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "创建分组失败");
      }
      setNewGroupName("");
      showToast("success", "分组已创建");
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "创建分组失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setGroupManageSaving(false);
    }
  }, [fetchFunds, newGroupName, showToast]);

  const onMoveGroup = useCallback(
    async (id: string, direction: "up" | "down") => {
      const index = groups.findIndex((group) => group.id === id);
      if (index < 0) {
        return;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= groups.length) {
        return;
      }

      const nextIds = groups.map((group) => group.id);
      const [moved] = nextIds.splice(index, 1);
      nextIds.splice(targetIndex, 0, moved);

      setGroupManageSaving(true);
      try {
        const response = await fetch("/api/v1/groups/reorder", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: nextIds })
        });
        const payload = (await response.json()) as GroupResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "排序保存失败");
        }
        showToast("success", "分组顺序已保存");
        await fetchFunds();
      } catch (error) {
        const message = classifyFetchFailure(error) || "排序保存失败";
        setErrorMessage(message);
        showToast("error", message);
      } finally {
        setGroupManageSaving(false);
      }
    },
    [fetchFunds, groups, showToast]
  );

  const onSubmitRenameGroup = useCallback(async () => {
    if (!renameGroupId) {
      return;
    }

    const name = renameGroupValue.trim();
    if (name.length === 0) {
      showToast("error", "分组名称不能为空");
      return;
    }

    setGroupManageSaving(true);
    try {
      const response = await fetch(`/api/v1/groups/${renameGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = (await response.json()) as GroupResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "重命名失败");
      }
      setRenameGroupId(null);
      setRenameGroupValue("");
      showToast("success", "分组已重命名");
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "重命名失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setGroupManageSaving(false);
    }
  }, [fetchFunds, renameGroupId, renameGroupValue, showToast]);

  const onDeleteGroup = useCallback(
    async (group: FundGroup) => {
      if (!window.confirm(`确认删除分组“${group.name}”？`)) {
        return;
      }

      setGroupManageSaving(true);
      try {
        const response = await fetch(`/api/v1/groups/${group.id}`, {
          method: "DELETE"
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "删除分组失败");
        }
        showToast("info", `已删除分组 ${group.name}`);
        await fetchFunds();
      } catch (error) {
        const message = classifyFetchFailure(error) || "删除分组失败";
        setErrorMessage(message);
        showToast("error", message);
      } finally {
        setGroupManageSaving(false);
      }
    },
    [fetchFunds, showToast]
  );

  const onSaveGroupMapping = useCallback(async () => {
    if (!editingGroupFundCode) {
      return;
    }

    setGroupEditSaving(true);
    try {
      const response = await fetch(`/api/v1/funds/${editingGroupFundCode}/groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: groupEditSelection })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "保存分组失败");
      }
      setEditingGroupFundCode(null);
      showToast("success", "分组已更新");
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "保存分组失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setGroupEditSaving(false);
    }
  }, [editingGroupFundCode, fetchFunds, groupEditSelection, showToast]);

  const onCreateRealtimeNote = useCallback(async () => {
    const code = focusedCode;
    if (!code) {
      return;
    }
    const content = realtimeNoteInput.trim();
    if (!content) {
      showToast("error", "请输入笔记内容");
      return;
    }

    setChecklistSavingByFund((prev) => ({ ...prev, [code]: true }));
    const payload = {
      tradeDate: getTodayShanghaiDateString(),
      triggerCondition: content,
      actionPlan: "来源：盘中实时记录",
      invalidCondition: "手动标记失效",
      reviewNote: "",
      status: "todo",
      priority: "medium" as DecisionChecklistPriority
    };
    try {
      const response = await fetch(`/api/v1/funds/${code}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "记录笔记失败");
      }
      setRealtimeNoteInput("");
      showToast("success", "笔记已记录");
      await loadChecklist(code);
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "记录笔记失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setChecklistSavingByFund((prev) => ({ ...prev, [code]: false }));
    }
  }, [fetchFunds, focusedCode, loadChecklist, realtimeNoteInput, showToast]);

  const onDeleteChecklistItem = useCallback(
    async (itemId: string) => {
      if (!focusedCode) {
        return;
      }
      setChecklistSavingByFund((prev) => ({ ...prev, [focusedCode]: true }));
      try {
        const response = await fetch(`/api/v1/funds/${focusedCode}/checklist/${itemId}`, { method: "DELETE" });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "删除执行项失败");
        }
        await loadChecklist(focusedCode);
        await fetchFunds();
        showToast("info", "笔记已删除");
      } catch (error) {
        const message = classifyFetchFailure(error) || "删除笔记失败";
        setErrorMessage(message);
        showToast("error", message);
      } finally {
        setChecklistSavingByFund((prev) => ({ ...prev, [focusedCode]: false }));
      }
    },
    [fetchFunds, focusedCode, loadChecklist, showToast]
  );

  const onOpenBatchGroup = useCallback((trigger: HTMLButtonElement) => {
    if (selectedCodes.length === 0) {
      showToast("info", "请先选择至少一只基金");
      return;
    }
    lastFocusRef.current = trigger;
    setBatchGroupSelection([]);
    setIsBatchGroupOpen(true);
  }, [selectedCodes.length, showToast]);

  const onApplyBatchGroups = useCallback(async () => {
    if (selectedCodes.length === 0) {
      return;
    }
    setBatchActionLoading("applyGroup");
    try {
      const response = await fetch("/api/v1/funds/batch/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: selectedCodes, groupIds: batchGroupSelection })
      });
      const payload = (await response.json()) as { error?: string; updatedCount?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? "批量分组失败");
      }
      setIsBatchGroupOpen(false);
      showToast("success", `批量分组已应用（${payload.updatedCount ?? selectedCodes.length} 只）`);
      await fetchFunds();
      onCancelSelect();
    } catch (error) {
      const message = classifyFetchFailure(error) || "批量分组失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setBatchActionLoading("idle");
    }
  }, [batchGroupSelection, fetchFunds, onCancelSelect, selectedCodes, showToast]);

  const onConfirmBatchDelete = useCallback(async () => {
    if (selectedCodes.length === 0) {
      return;
    }
    setBatchActionLoading("delete");
    try {
      const response = await fetch("/api/v1/funds/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: selectedCodes })
      });
      const payload = (await response.json()) as { error?: string; deletedCount?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? "批量删除失败");
      }
      setIsBatchDeleteOpen(false);
      showToast("success", `已删除 ${payload.deletedCount ?? selectedCodes.length} 只基金`);
      await fetchFunds();
      onCancelSelect();
    } catch (error) {
      const message = classifyFetchFailure(error) || "批量删除失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setBatchActionLoading("idle");
    }
  }, [fetchFunds, onCancelSelect, selectedCodes, showToast]);

  const onSaveReview = useCallback(async () => {
    const code = editingReviewFundCode;
    if (!code) {
      return;
    }
    if (
      !reviewFormTitle.trim() ||
      !reviewFormDate ||
      !reviewFormExpectation.trim() ||
      !reviewFormResult.trim() ||
      !reviewFormReason.trim() ||
      !reviewFormActionPlan.trim()
    ) {
      showToast("error", "请完整填写复盘模板字段");
      return;
    }

    setReviewSavingByFund((prev) => ({ ...prev, [code]: true }));
    const payload = {
      title: reviewFormTitle.trim(),
      reviewDate: reviewFormDate,
      expectation: reviewFormExpectation.trim(),
      result: reviewFormResult.trim(),
      reason: reviewFormReason.trim(),
      actionPlan: reviewFormActionPlan.trim(),
      tags: parseTagInput(reviewFormTags).slice(0, 10)
    };
    try {
      const response = await fetch(
        editingReviewId ? `/api/v1/funds/${code}/reviews/${editingReviewId}` : `/api/v1/funds/${code}/reviews`,
        {
          method: editingReviewId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      const result = (await response.json()) as ReviewResponse | ApiErrorResponse;
      if (!response.ok) {
        throw new Error((result as ApiErrorResponse).error ?? "保存复盘失败");
      }
      const savedNote = (result as ReviewResponse).note;
      showToast("success", editingReviewId ? "复盘已更新" : "复盘已保存");
      setReviewSelectedIdByFund((prev) => ({ ...prev, [code]: savedNote.id }));
      resetReviewForm(savedNote);
      setReviewDraftDirty(false);
      setReviewMobilePane("editor");
      await loadFundReviews(code);
      await fetchFunds();
    } catch (error) {
      const message = classifyFetchFailure(error) || "保存复盘失败";
      setErrorMessage(message);
      showToast("error", message);
    } finally {
      setReviewSavingByFund((prev) => ({ ...prev, [code]: false }));
    }
  }, [
    editingReviewFundCode,
    editingReviewId,
    fetchFunds,
    loadFundReviews,
    parseTagInput,
    resetReviewForm,
    reviewFormActionPlan,
    reviewFormTitle,
    reviewFormDate,
    reviewFormExpectation,
    reviewFormReason,
    reviewFormResult,
    reviewFormTags,
    showToast
  ]);

  const onDeleteReview = useCallback(
    async (id: string) => {
      const code = editingReviewFundCode;
      if (!code) {
        return;
      }
      if (!window.confirm("确认删除这条复盘笔记？")) {
        return;
      }
      setReviewSavingByFund((prev) => ({ ...prev, [code]: true }));
      try {
        const response = await fetch(`/api/v1/funds/${code}/reviews/${id}`, { method: "DELETE" });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "删除复盘失败");
        }
        showToast("info", "复盘已删除");
        if (editingReviewId === id) {
          setReviewSelectedIdByFund((prev) => ({ ...prev, [code]: null }));
          resetReviewForm(null);
        }
        setReviewDraftDirty(false);
        await loadFundReviews(code);
        await fetchFunds();
      } catch (error) {
        const message = classifyFetchFailure(error) || "删除复盘失败";
        setErrorMessage(message);
        showToast("error", message);
      } finally {
        setReviewSavingByFund((prev) => ({ ...prev, [code]: false }));
      }
    },
    [editingReviewFundCode, editingReviewId, fetchFunds, loadFundReviews, resetReviewForm, showToast]
  );

  const onSelectReviewNote = useCallback(
    (note: FundReviewNote) => {
      if (!confirmDiscardReviewDraft()) {
        return;
      }
      if (!editingReviewFundCode) {
        return;
      }
      setReviewSelectedIdByFund((prev) => ({ ...prev, [editingReviewFundCode]: note.id }));
      resetReviewForm(note);
      setReviewMobilePane("editor");
    },
    [confirmDiscardReviewDraft, editingReviewFundCode, resetReviewForm]
  );

  const onStartNewReview = useCallback(() => {
    if (!confirmDiscardReviewDraft()) {
      return;
    }
    if (!editingReviewFundCode) {
      return;
    }
    setReviewSelectedIdByFund((prev) => ({ ...prev, [editingReviewFundCode]: null }));
    resetReviewForm(null);
    setReviewMobilePane("editor");
  }, [confirmDiscardReviewDraft, editingReviewFundCode, resetReviewForm]);

  const activeGroupName = useMemo(() => {
    const tab = groupTabs.find((item) => item.id === groupFilter);
    return tab?.name ?? "全部";
  }, [groupFilter, groupTabs]);

  const focusedFund = useMemo(
    () => funds.find((fund) => fund.code === focusedCode) ?? null,
    [focusedCode, funds]
  );

  const renderFundCard = useCallback(
    (fund: FundCardData) => {
      const activeRange = historyRangeByFund[fund.code] ?? DEFAULT_HISTORY_RANGE;
      const panelData = historyCacheByFund[fund.code]?.[activeRange];
      return (
        <FundCard
          key={fund.code}
          fund={fund}
          expanded={expandedFundCode === fund.code}
          historyRange={activeRange}
          historyState={historyStateByFund[fund.code]}
          historyAnalysis={panelData?.analysis}
          historyStartDate={panelData?.startDate ?? null}
          historyEndDate={panelData?.endDate ?? null}
          historyError={historyErrorByFund[fund.code]}
          maskAmounts={maskAmounts}
          positionSaving={positionSavingByFund[fund.code]}
          compact
          isSelecting={isSelecting}
          isSelected={selectedCodes.includes(fund.code)}
          focused={focusedCode === fund.code}
          onDelete={onOpenDeleteModal}
          onToggleSelect={onToggleSelectFund}
          onFocus={setFocusedCode}
          onOpenPositionEditor={onOpenPositionEditor}
          onOpenGroupEditor={onOpenGroupEditor}
          onOpenReviewEditor={onOpenReviewEditor}
          onToggleHistory={onToggleHistory}
          onChangeHistoryRange={onChangeHistoryRange}
          onRetryHistory={onRetryHistory}
        />
      );
    },
    [
      expandedFundCode,
      focusedCode,
      historyCacheByFund,
      historyErrorByFund,
      historyRangeByFund,
      historyStateByFund,
      isSelecting,
      maskAmounts,
      onChangeHistoryRange,
      onOpenDeleteModal,
      onOpenGroupEditor,
      onOpenPositionEditor,
      onOpenReviewEditor,
      onRetryHistory,
      onToggleHistory,
      onToggleSelectFund,
      positionSavingByFund,
      selectedCodes
    ]
  );

  const renderCards = useMemo(() => {
    if (loadingState === "loading" && funds.length === 0) {
      return (
        <>
          <LoadingExample />
          <LoadingExample />
          <LoadingExample />
        </>
      );
    }
    if (loadingState === "empty" && funds.length === 0) {
      return <EmptyExample />;
    }
    if (loadingState === "noResult" && funds.length === 0) {
      return <NoResultExample onClear={onClearSearch} groupFilter={groupFilter} activeGroupName={activeGroupName} />;
    }
    if (loadingState === "error" && funds.length === 0) {
      return <ErrorExample onRetry={() => void fetchFunds({ showLoading: true })} />;
    }

    return funds.map((fund) => renderFundCard(fund));
  }, [
    activeGroupName,
    fetchFunds,
    funds,
    groupFilter,
    loadingState,
    onClearSearch,
    renderFundCard
  ]);

  const editingFund = useMemo(
    () => funds.find((fund) => fund.code === editingPositionFundCode) ?? null,
    [editingPositionFundCode, funds]
  );

  const groupEditingFund = useMemo(
    () => funds.find((fund) => fund.code === editingGroupFundCode) ?? null,
    [editingGroupFundCode, funds]
  );

  const reviewEditingFund = useMemo(
    () => funds.find((fund) => fund.code === editingReviewFundCode) ?? null,
    [editingReviewFundCode, funds]
  );

  const activeReviewNotes = useMemo(
    () => (editingReviewFundCode ? reviewNotesByFund[editingReviewFundCode] ?? [] : []),
    [editingReviewFundCode, reviewNotesByFund]
  );
  const selectedReviewNote = useMemo(
    () => activeReviewNotes.find((note) => note.id === editingReviewId) ?? null,
    [activeReviewNotes, editingReviewId]
  );

  const reviewListQuery = editingReviewFundCode ? reviewListQueryByFund[editingReviewFundCode] ?? "" : "";

  const filteredReviewNotes = useMemo(() => {
    const keyword = reviewListQuery.trim().toLowerCase();
    if (!keyword) {
      return activeReviewNotes;
    }
    return activeReviewNotes.filter((note) => note.title.toLowerCase().includes(keyword));
  }, [activeReviewNotes, reviewListQuery]);

  const groupedReviewNotes = useMemo(() => {
    const groups: Array<{ date: string; notes: FundReviewNote[] }> = [];
    for (const note of filteredReviewNotes) {
      const existing = groups.find((group) => group.date === note.reviewDate);
      if (existing) {
        existing.notes.push(note);
      } else {
        groups.push({ date: note.reviewDate, notes: [note] });
      }
    }
    return groups;
  }, [filteredReviewNotes]);

  useEffect(() => {
    if (!editingReviewFundCode) {
      return;
    }
    const selectedId = reviewSelectedIdByFund[editingReviewFundCode];
    if (selectedId === null) {
      if (editingReviewId !== null) {
        resetReviewForm(null);
      }
      return;
    }

    const preferredId = selectedId ?? activeReviewNotes[0]?.id ?? null;
    const found = preferredId ? activeReviewNotes.find((note) => note.id === preferredId) ?? null : null;
    if (!found) {
      resetReviewForm(null);
      return;
    }

    setEditingReviewId(found.id);
    if (editingReviewId !== found.id) {
      resetReviewForm(found);
    }
  }, [activeReviewNotes, editingReviewFundCode, editingReviewId, resetReviewForm, reviewSelectedIdByFund]);

  useEffect(() => {
    if (!editingReviewFundCode) {
      return;
    }

    const onReviewKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void onSaveReview();
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName ?? "";
      const isEditable =
        target?.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
      if (isEditable) {
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      if (filteredReviewNotes.length === 0) {
        return;
      }

      event.preventDefault();
      const currentId = reviewSelectedIdByFund[editingReviewFundCode] ?? editingReviewId;
      const currentIndex = currentId ? filteredReviewNotes.findIndex((note) => note.id === currentId) : 0;
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex =
        event.key === "ArrowDown"
          ? Math.min(filteredReviewNotes.length - 1, baseIndex + 1)
          : Math.max(0, baseIndex - 1);
      const nextNote = filteredReviewNotes[nextIndex];
      if (nextNote) {
        onSelectReviewNote(nextNote);
      }
    };

    document.addEventListener("keydown", onReviewKeydown);
    return () => {
      document.removeEventListener("keydown", onReviewKeydown);
    };
  }, [
    editingReviewFundCode,
    editingReviewId,
    filteredReviewNotes,
    onSaveReview,
    onSelectReviewNote,
    reviewSelectedIdByFund
  ]);

  const focusedChecklistItems = useMemo(
    () => (focusedCode ? checklistByFund[focusedCode] ?? [] : []),
    [checklistByFund, focusedCode]
  );

  return (
    <main className="dashboard-shell">
      <section className="dashboard-panel">
        <header className="header-bar">
          <div className="brand-block">
            <div className="brand-title-row">
              <ChartNoAxesCombined size={22} className="text-accent" />
              <h1>基金当日估值</h1>
            </div>
            <p>自选基金实时估算 · 仅供交易参考</p>
            <div className="status-row" role="status" aria-live="polite">
              <button
                type="button"
                className="privacy-toggle-btn"
                onClick={() => setMaskAmounts((prev) => !prev)}
                aria-pressed={maskAmounts}
                aria-label="切换金额隐私模式"
              >
                {maskAmounts ? <EyeOff size={12} /> : <Eye size={12} />}
                {maskAmounts ? "金额已隐藏" : "金额隐私"}
              </button>
              <span className="last-updated">
                最近刷新：{formatLastUpdatedAt(lastUpdatedAt)}
                {isRefreshing ? " · 更新中" : ""}
              </span>
            </div>
          </div>

          <button
            className="add-fund-btn mobile-only"
            type="button"
            onClick={(event) => onOpenAddModal(event.currentTarget)}
          >
            <span className="plus-glyph plus-glyph-sm">+</span>
            添加
          </button>

          <div className="actions-row actions-row-desktop">
            <button
              type="button"
              className={cn("ghost-btn selection-toggle-btn", isSelecting && "active")}
              onClick={isSelecting ? onCancelSelect : onStartSelect}
            >
              {isSelecting ? "退出多选" : "多选"}
            </button>
            <button
              className="add-fund-btn"
              type="button"
              onClick={(event) => onOpenAddModal(event.currentTarget)}
            >
              <span className="plus-glyph">+</span>
              添加基金
            </button>
            <label className="search-input" aria-label="搜索基金">
              <Search size={18} className="text-muted" />
              <input
                ref={desktopSearchRef}
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setQuery(queryInput);
                  }
                }}
                placeholder="搜索基金代码"
              />
              {queryInput ? (
                <button type="button" className="search-clear-btn" onClick={onClearSearch} aria-label="清空搜索">
                  <X size={14} />
                </button>
              ) : null}
            </label>
          </div>
        </header>
        <div className="actions-row actions-row-mobile">
          <button
            type="button"
            className={cn("ghost-btn selection-toggle-btn", isSelecting && "active")}
            onClick={isSelecting ? onCancelSelect : onStartSelect}
          >
            {isSelecting ? "退出多选" : "多选"}
          </button>
          <label className="search-input" aria-label="搜索基金">
            <Search size={16} className="text-muted" />
            <input
              ref={mobileSearchRef}
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setQuery(queryInput);
                }
              }}
              placeholder="搜索基金代码"
            />
            {queryInput ? (
              <button type="button" className="search-clear-btn" onClick={onClearSearch} aria-label="清空搜索">
                <X size={14} />
              </button>
            ) : null}
          </label>
        </div>

        {errorMessage ? (
          <div className="inline-error" role="alert" aria-live="assertive">
            <AlertTriangle size={14} />
            {errorMessage}
          </div>
        ) : null}

        <section className="workspace-shell desktop-only">
          <div className="workspace-grid workspace-grid-two">
            <section className="workspace-main-column">
              <GroupTabBar
                tabs={groupTabs}
                activeGroupId={groupFilter}
                onChange={setGroupFilter}
                onOpenManage={onOpenGroupManage}
              />
              <GroupPerformanceBar summary={groupPerformance} />
              <section className="sort-segment workspace-sort-segment" aria-label="排序控件">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn("sort-btn", sortBy === option.value && "active")}
                    onClick={() => setSortBy(option.value)}
                  >
                    <span>{option.label}</span>
                    {option.icon}
                  </button>
                ))}
              </section>
              <section className="cards-grid cards-grid-mosaic">{renderCards}</section>
            </section>
            <aside className="workspace-right">
              <RealtimeNotesSidebar
                key={`desktop-${focusedCode ?? "empty"}`}
                focusedFund={focusedFund}
                items={focusedChecklistItems}
                loading={Boolean(focusedCode ? checklistLoadingByFund[focusedCode] : false)}
                saving={Boolean(focusedCode ? checklistSavingByFund[focusedCode] : false)}
                noteInput={realtimeNoteInput}
                noteInputRef={noteInputRef}
                onNoteInputChange={setRealtimeNoteInput}
                onAdd={() => void onCreateRealtimeNote()}
                onDelete={(itemId) => void onDeleteChecklistItem(itemId)}
                onOpenReviewEditor={onOpenReviewEditor}
              />
            </aside>
          </div>
        </section>

        <section className="mobile-workspace mobile-only">
          <section className="mobile-workspace-content">
            {mobileWorkspaceTab === "intraday" ? (
              <>
                <GroupTabBar
                  tabs={groupTabs}
                  activeGroupId={groupFilter}
                  onChange={setGroupFilter}
                  onOpenManage={onOpenGroupManage}
                />
                <GroupPerformanceBar summary={groupPerformance} />
                <section className="sort-segment" aria-label="排序控件">
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cn("sort-btn", sortBy === option.value && "active")}
                      onClick={() => setSortBy(option.value)}
                    >
                      <span>{option.label}</span>
                      {option.icon}
                    </button>
                  ))}
                </section>
                <section className="cards-grid cards-grid-mosaic mobile-mosaic">{renderCards}</section>
              </>
            ) : (
              <RealtimeNotesSidebar
                key={`mobile-${focusedCode ?? "empty"}`}
                focusedFund={focusedFund}
                items={focusedChecklistItems}
                loading={Boolean(focusedCode ? checklistLoadingByFund[focusedCode] : false)}
                saving={Boolean(focusedCode ? checklistSavingByFund[focusedCode] : false)}
                noteInput={realtimeNoteInput}
                noteInputRef={noteInputRef}
                onNoteInputChange={setRealtimeNoteInput}
                onAdd={() => void onCreateRealtimeNote()}
                onDelete={(itemId) => void onDeleteChecklistItem(itemId)}
                onOpenReviewEditor={onOpenReviewEditor}
              />
            )}
          </section>
          <nav className="workspace-tabs" aria-label="移动工作台标签">
            <button
              type="button"
              className={cn("workspace-tab-btn", mobileWorkspaceTab === "intraday" && "active")}
              onClick={() => setMobileWorkspaceTab("intraday")}
            >
              主栏
            </button>
            <button
              type="button"
              className={cn("workspace-tab-btn", mobileWorkspaceTab === "review" && "active")}
              onClick={() => setMobileWorkspaceTab("review")}
            >
              笔记
            </button>
          </nav>
        </section>
      </section>

      {isSelecting ? (
        <section className="batch-floating-bar" aria-live="polite">
          <p>已选择 {selectedCodes.length} 只基金</p>
          <div className="batch-floating-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={(event) => onOpenBatchGroup(event.currentTarget)}
              disabled={batchActionLoading !== "idle" || selectedCodes.length === 0}
            >
              批量分组
            </button>
            <button
              type="button"
              className="danger-btn"
              onClick={(event) => {
                if (selectedCodes.length === 0) {
                  return;
                }
                lastFocusRef.current = event.currentTarget;
                setIsBatchDeleteOpen(true);
              }}
              disabled={batchActionLoading !== "idle" || selectedCodes.length === 0}
            >
              批量删除
            </button>
            <button type="button" className="ghost-btn" onClick={onCancelSelect} disabled={batchActionLoading !== "idle"}>
              取消
            </button>
          </div>
        </section>
      ) : null}

      {isAddOpen ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-fund-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsAddOpen(false);
            }
          }}
        >
          <section className="modal-card" ref={addModalRef}>
            <h3 id="add-fund-title">添加基金</h3>
            <label className="modal-input-wrap">
              <span>基金代码（6位）</span>
              <input
                className="modal-input"
                placeholder="例如 161725"
                value={newCode}
                maxLength={6}
                onChange={(event) => setNewCode(event.target.value)}
              />
            </label>
            <label className="modal-input-wrap">
              <span>基金名称（可选）</span>
              <input
                className="modal-input"
                placeholder="用于本地备注"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <div className="modal-input-wrap">
              <span>分组（可多选）</span>
              <div className="group-select-grid">
                {groups.length === 0 ? <p className="modal-hint">还没有分组，可先在“管理分组”创建</p> : null}
                {groups.map((group) => {
                  const selected = newFundGroupIds.includes(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      className={cn("group-select-option", selected && "selected")}
                      onClick={() => {
                        setNewFundGroupIds((prev) =>
                          prev.includes(group.id) ? prev.filter((item) => item !== group.id) : [...prev, group.id]
                        );
                      }}
                    >
                      <span>{group.name}</span>
                      {selected ? <Check size={13} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setIsAddOpen(false)}>
                取消
              </button>
              <button type="button" className="add-fund-btn compact" onClick={onAddFund}>
                确认添加
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isGroupManageOpen ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-manage-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsGroupManageOpen(false);
            }
          }}
        >
          <section className="modal-card group-manage-card" ref={groupManageModalRef}>
            <h3 id="group-manage-title">分组管理</h3>
            <p className="modal-sub">拖拽排序 · 重命名 · 删除（最多 20 组）</p>
            <div className="group-create-row">
              <input
                className="modal-input"
                value={newGroupName}
                placeholder="新建分组名"
                onChange={(event) => setNewGroupName(event.target.value)}
                maxLength={20}
              />
              <button type="button" className="add-fund-btn compact" onClick={() => void onCreateGroup()} disabled={groupManageSaving}>
                <Plus size={13} />
                新建
              </button>
            </div>
            <div className="group-manage-list">
              {groups.length === 0 ? <p className="modal-hint">暂无分组</p> : null}
              {groups.map((group, index) => {
                const editing = renameGroupId === group.id;
                return (
                  <div key={group.id} className="group-manage-item">
                    <div className="group-manage-main">
                      <span className="group-grip" aria-hidden="true">
                        <GripVertical size={13} />
                      </span>
                      {editing ? (
                        <input
                          className="modal-input group-rename-input"
                          value={renameGroupValue}
                          onChange={(event) => setRenameGroupValue(event.target.value)}
                          maxLength={20}
                        />
                      ) : (
                        <span className="group-manage-name">
                          {group.name}（{group.fundCount}）
                        </span>
                      )}
                    </div>
                    <div className="group-manage-actions">
                      <button
                        type="button"
                        className="ghost-btn icon-btn"
                        onClick={() => void onMoveGroup(group.id, "up")}
                        disabled={groupManageSaving || index === 0}
                        aria-label="上移"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="ghost-btn icon-btn"
                        onClick={() => void onMoveGroup(group.id, "down")}
                        disabled={groupManageSaving || index === groups.length - 1}
                        aria-label="下移"
                      >
                        <ArrowDown size={13} />
                      </button>
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="add-fund-btn compact"
                            onClick={() => void onSubmitRenameGroup()}
                            disabled={groupManageSaving}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              setRenameGroupId(null);
                              setRenameGroupValue("");
                            }}
                            disabled={groupManageSaving}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              setRenameGroupId(group.id);
                              setRenameGroupValue(group.name);
                            }}
                            disabled={groupManageSaving}
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => void onDeleteGroup(group)}
                            disabled={groupManageSaving}
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setIsGroupManageOpen(false)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editingGroupFundCode && groupEditingFund ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-edit-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setEditingGroupFundCode(null);
            }
          }}
        >
          <section className="modal-card" ref={groupEditModalRef}>
            <h3 id="group-edit-title">编辑基金分组</h3>
            <p className="modal-sub">基金：{groupEditingFund.name}（{groupEditingFund.code}）</p>
            <div className="group-select-grid">
              {groups.map((group) => {
                const selected = groupEditSelection.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={cn("group-select-option", selected && "selected")}
                    onClick={() => {
                      setGroupEditSelection((prev) =>
                        prev.includes(group.id) ? prev.filter((item) => item !== group.id) : [...prev, group.id]
                      );
                    }}
                  >
                    <span>{group.name}</span>
                    {selected ? <Check size={13} /> : null}
                  </button>
                );
              })}
              <button
                type="button"
                className={cn("group-select-option", groupEditSelection.length === 0 && "selected")}
                onClick={() => setGroupEditSelection([])}
              >
                <span>未分组</span>
                {groupEditSelection.length === 0 ? <Check size={13} /> : null}
              </button>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setEditingGroupFundCode(null)}
                disabled={groupEditSaving}
              >
                取消
              </button>
              <button
                type="button"
                className="add-fund-btn compact"
                onClick={() => void onSaveGroupMapping()}
                disabled={groupEditSaving}
              >
                {groupEditSaving ? "保存中..." : "保存分组"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isBatchGroupOpen ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-group-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsBatchGroupOpen(false);
            }
          }}
        >
          <section className="modal-card" ref={batchGroupModalRef}>
            <h3 id="batch-group-title">批量设置分组</h3>
            <p className="modal-sub">将覆盖 {selectedCodes.length} 只基金的分组归属</p>
            <div className="group-select-grid">
              {groups.map((group) => {
                const selected = batchGroupSelection.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={cn("group-select-option", selected && "selected")}
                    onClick={() => {
                      setBatchGroupSelection((prev) =>
                        prev.includes(group.id) ? prev.filter((item) => item !== group.id) : [...prev, group.id]
                      );
                    }}
                  >
                    <span>{group.name}</span>
                    {selected ? <Check size={13} /> : null}
                  </button>
                );
              })}
              <button
                type="button"
                className={cn("group-select-option", batchGroupSelection.length === 0 && "selected")}
                onClick={() => setBatchGroupSelection([])}
              >
                <span>全部设为未分组</span>
                {batchGroupSelection.length === 0 ? <Check size={13} /> : null}
              </button>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setIsBatchGroupOpen(false)}
                disabled={batchActionLoading !== "idle"}
              >
                取消
              </button>
              <button
                type="button"
                className="add-fund-btn compact"
                onClick={() => void onApplyBatchGroups()}
                disabled={batchActionLoading !== "idle"}
              >
                {batchActionLoading === "applyGroup" ? "保存中..." : "确认应用"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editingPositionFundCode && editingFund ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="position-edit-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setEditingPositionFundCode(null);
            }
          }}
        >
          <section className="modal-card" ref={positionModalRef}>
            <h3 id="position-edit-title">编辑持仓</h3>
            <label className="modal-input-wrap">
              <span>持有份额</span>
              <input
                className="modal-input"
                placeholder="例如 1280.50"
                value={positionFormShares}
                inputMode="decimal"
                onChange={(event) => setPositionFormShares(event.target.value)}
              />
            </label>
            <label className="modal-input-wrap">
              <span>单位持仓成本</span>
              <input
                className="modal-input"
                placeholder="例如 2.1800"
                value={positionFormCostPerUnit}
                inputMode="decimal"
                onChange={(event) => setPositionFormCostPerUnit(event.target.value)}
              />
            </label>
            <p className="position-modal-hint">当日盈亏 = 份额 × (估算净值 - 单位净值)</p>
            <div className="modal-actions modal-actions-space">
              <button
                type="button"
                className="danger-btn"
                onClick={() => void onClearPosition()}
                disabled={positionSavingByFund[editingPositionFundCode]}
              >
                清空持仓
              </button>
              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setEditingPositionFundCode(null)}
                  disabled={positionSavingByFund[editingPositionFundCode]}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="add-fund-btn compact"
                  onClick={() => void onSavePosition()}
                  disabled={positionSavingByFund[editingPositionFundCode]}
                >
                  {positionSavingByFund[editingPositionFundCode] ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {editingReviewFundCode && reviewEditingFund ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-edit-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeReviewWorkspace();
            }
          }}
        >
          <section
            className={cn(
              "modal-card review-workspace-modal",
              reviewMobilePane === "list" ? "review-mobile-list" : "review-mobile-editor"
            )}
            ref={reviewModalRef}
          >
            <header className="review-workspace-header">
              <div>
                <h3 id="review-edit-title">{reviewEditingFund.code} {reviewEditingFund.name} · 历史复盘笔记</h3>
                <p className="modal-sub">按日期分组，默认近到远</p>
              </div>
              <div className="review-workspace-header-actions">
                {reviewDraftDirty ? <span className="review-dirty-chip">草稿未保存</span> : null}
                <button type="button" className="ghost-btn icon-btn" onClick={closeReviewWorkspace} aria-label="关闭复盘工作台">
                  <X size={14} />
                </button>
              </div>
            </header>

            <div className="review-workspace-body">
              <aside className="review-list-pane">
                <div className="review-list-toolbar">
                  <label className="review-list-search" aria-label="搜索复盘标题">
                    <Search size={14} className="text-muted" />
                    <input
                      className="modal-input"
                      value={reviewListQuery}
                      onChange={(event) => {
                        setReviewListQueryByFund((prev) => ({
                          ...prev,
                          [editingReviewFundCode]: event.target.value
                        }));
                      }}
                      placeholder="搜索标题"
                    />
                  </label>
                  <button type="button" className="add-fund-btn compact" onClick={onStartNewReview}>
                    + 新建笔记
                  </button>
                </div>
                <div className="review-date-groups" role="listbox" aria-label="历史复盘列表">
                  {reviewLoadingByFund[editingReviewFundCode] ? <p className="modal-hint">加载中...</p> : null}
                  {!reviewLoadingByFund[editingReviewFundCode] && filteredReviewNotes.length === 0 ? (
                    <p className="modal-hint">暂无笔记，点击右上角新建</p>
                  ) : null}
                  {groupedReviewNotes.map((group) => (
                    <section key={group.date} className="review-date-group">
                      <p className="review-date-title">{group.date}</p>
                      {group.notes.map((note) => (
                        <button
                          key={note.id}
                          type="button"
                          className={cn("review-title-item", editingReviewId === note.id && "active")}
                          onClick={() => onSelectReviewNote(note)}
                        >
                          {note.title}
                        </button>
                      ))}
                    </section>
                  ))}
                </div>
              </aside>

              <section className="review-editor-pane">
                <div className="review-editor-head">
                  <div>
                    <p className="review-editor-title">{editingReviewId ? "选中笔记详情" : "新建笔记"}</p>
                    <p className="review-editor-meta">Cmd/Ctrl+S 可快速保存</p>
                  </div>
                  <div className="review-editor-head-actions">
                    <button type="button" className="ghost-btn review-mobile-back-btn" onClick={() => setReviewMobilePane("list")}>
                      返回列表
                    </button>
                    <span className="review-editor-state-chip">{reviewDraftDirty ? "草稿中" : "已保存"}</span>
                  </div>
                </div>
                <div className="review-editor-form">
                  <label className="modal-input-wrap">
                    <span>标题</span>
                    <input
                      className="modal-input"
                      value={reviewFormTitle}
                      maxLength={60}
                      onChange={(event) => {
                        setReviewFormTitle(event.target.value);
                        setReviewDraftDirty(true);
                      }}
                      placeholder="例如：半导体午后回撤复盘"
                    />
                  </label>
                  <label className="modal-input-wrap">
                    <span>日期</span>
                    <input
                      className="modal-input"
                      type="date"
                      value={reviewFormDate}
                      onChange={(event) => {
                        setReviewFormDate(event.target.value);
                        setReviewDraftDirty(true);
                      }}
                    />
                  </label>

                  <div className="review-template-block">
                    <label className="modal-input-wrap">
                      <span>预期</span>
                      <textarea
                        className="modal-textarea review-textarea-sm"
                        value={reviewFormExpectation}
                        onChange={(event) => {
                          setReviewFormExpectation(event.target.value);
                          setReviewDraftDirty(true);
                        }}
                        placeholder="记录你的预期判断"
                      />
                    </label>
                    <label className="modal-input-wrap">
                      <span>结果</span>
                      <textarea
                        className="modal-textarea review-textarea-sm"
                        value={reviewFormResult}
                        onChange={(event) => {
                          setReviewFormResult(event.target.value);
                          setReviewDraftDirty(true);
                        }}
                        placeholder="记录实际盘中表现"
                      />
                    </label>
                    <label className="modal-input-wrap">
                      <span>原因</span>
                      <textarea
                        className="modal-textarea review-textarea-sm"
                        value={reviewFormReason}
                        onChange={(event) => {
                          setReviewFormReason(event.target.value);
                          setReviewDraftDirty(true);
                        }}
                        placeholder="分析关键原因"
                      />
                    </label>
                    <label className="modal-input-wrap">
                      <span>改进动作</span>
                      <textarea
                        className="modal-textarea review-textarea-sm"
                        value={reviewFormActionPlan}
                        onChange={(event) => {
                          setReviewFormActionPlan(event.target.value);
                          setReviewDraftDirty(true);
                        }}
                        placeholder="下一步动作"
                      />
                    </label>
                    <label className="modal-input-wrap">
                      <span>标签（逗号分隔）</span>
                      <input
                        className="modal-input"
                        value={reviewFormTags}
                        onChange={(event) => {
                          setReviewFormTags(event.target.value);
                          setReviewDraftDirty(true);
                        }}
                        placeholder="如：半导体,回撤,止盈"
                      />
                    </label>
                  </div>

                </div>

                <div className="modal-actions review-editor-footer">
                  <span className="review-editor-footer-note">该基金历史笔记 · 默认近到远</span>
                  <div className="review-editor-footer-actions">
                    {editingReviewId ? (
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => void onDeleteReview(editingReviewId)}
                        disabled={Boolean(reviewSavingByFund[editingReviewFundCode])}
                      >
                        删除
                      </button>
                    ) : null}
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      if (!confirmDiscardReviewDraft()) {
                        return;
                      }
                      resetReviewForm(selectedReviewNote);
                    }}
                  >
                    取消修改
                  </button>
                  <button
                    type="button"
                    className="add-fund-btn compact"
                    onClick={() => void onSaveReview()}
                    disabled={Boolean(reviewSavingByFund[editingReviewFundCode])}
                  >
                    {reviewSavingByFund[editingReviewFundCode] ? "保存中..." : editingReviewId ? "更新笔记" : "保存笔记"}
                  </button>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {isBatchDeleteOpen ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-batch-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsBatchDeleteOpen(false);
            }
          }}
        >
          <section className="modal-card delete-card" ref={batchDeleteModalRef}>
            <h3 id="delete-batch-title">确认批量删除?</h3>
            <p>将删除已选择的 {selectedCodes.length} 只基金，可稍后重新添加。</p>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setIsBatchDeleteOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => void onConfirmBatchDelete()}
                disabled={batchActionLoading !== "idle"}
              >
                {batchActionLoading === "delete" ? "删除中..." : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDeleteCode ? (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-fund-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPendingDeleteCode(null);
            }
          }}
        >
          <section className="modal-card delete-card" ref={deleteModalRef}>
            <h3 id="delete-fund-title">确认删除基金?</h3>
            <p>删除后将从自选列表移除，稍后可重新添加。</p>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setPendingDeleteCode(null)}>
                取消
              </button>
              <button type="button" className="danger-btn" onClick={confirmDeleteFund}>
                确认删除
              </button>
            </div>
            <div className="delete-code">{pendingDeleteCode}</div>
          </section>
        </div>
      ) : null}

      {toast ? (
        <div
          className={cn("toast", `toast-${toast.tone}`)}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
        >
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}
