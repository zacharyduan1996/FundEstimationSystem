# 历史分析功能开发映射清单（基于 `fund-valuation-demo.pen`）

## 1. 目标与边界

- 目标：按设计稿 1:1 落地“历史净值分析（收益 + 回撤）”，仅在现有列表页内完成。
- 不新增页面：仅增强现有 Web/Mobile Dashboard 的 `FundCard`。
- 状态示例仅用于开发对照，不可常驻主页面。

---

## 2. 设计源与节点定位（Pencil）

- 设计文件：`/Users/raymondj/Documents/Raymond/personal/financial/fund-valuation-demo.pen`
- 主画板
  - Web Dashboard：`tSbS5`
  - Mobile Dashboard：`zpsgv`
  - Component Specs：`DSWyN`
- 历史分析展开区
  - Web `HistoryExpandPanel`：`3Kj8l`
  - Mobile `HistoryExpandPanel`：`UVyQX`
- 规范区关键节点
  - `FundHistoryAnalysisContract`：`abATX`
  - 历史状态规范：`YMiKV`
  - 全局状态规范：`TJzus`
  - 关键交互标注：`bi3Nc`
  - 响应式规则：`8alVP`

---

## 3. 前端组件映射（建议与现代码对齐）

## 3.1 组件拆分

- `FundCard`（已有）
  - 保留顶部信息、净值区、日内图（`Sparkline`）
  - 新增历史区折叠开关与展开容器
- `HistoryExpandPanel`（新增）
  - 子组件：`RangeSegment`、`HistoryLineChart`、`HistoryMetricCard`、状态块
- `RangeSegment`（新增）
  - 固定五档：`7D / 30D / 90D / 180D / 1Y`
- `HistoryMetricCard`（新增）
  - 展示：区间收益、最大回撤、区间高点、区间低点
- `HistoryStateBlock`（新增）
  - 仅用于 `HistoryExpandPanel` 内：`loading / ready / empty / error`

## 3.2 类型契约（建议新增到 `lib/types.ts`）

```ts
export type HistoryRange = "7D" | "30D" | "90D" | "180D" | "1Y";
export type HistoryLoadingState = "loading" | "ready" | "empty" | "error";

export interface HistoryPoint {
  ts: string;      // ISO8601
  nav: number;     // 该时点净值
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

// UI 扩展状态（与现有 UIState 兼容增量）
export interface HistoryUIStateExtension {
  expandedFundCode?: string;
  historyStateByFund: Record<string, HistoryLoadingState>;
  historyRangeByFund: Record<string, HistoryRange>;
}
```

---

## 4. API 映射（V1.2 增量）

> 现有接口保持兼容；历史分析建议新增独立接口，避免污染 `GET /api/v1/funds`。

- 保持不变
  - `GET /api/v1/funds?query=&sortBy=`
  - `POST /api/v1/funds`
  - `DELETE /api/v1/funds/{code}`
  - `GET /api/v1/funds/{code}/trend?date=YYYY-MM-DD`
- 新增建议
  - `GET /api/v1/funds/{code}/history?range=7D|30D|90D|180D|1Y`

示例响应：

```json
{
  "code": "004432",
  "analysis": {
    "range": "90D",
    "points": [{ "ts": "2026-03-06T14:30:00+08:00", "nav": 2.2923, "deltaPct": -5.6 }],
    "returnPct": 4.82,
    "maxDrawdownPct": -2.16,
    "periodHigh": { "nav": 2.3186, "ts": "2026-02-18T15:00:00+08:00" },
    "periodLow": { "nav": 2.1472, "ts": "2026-01-05T15:00:00+08:00" },
    "updatedAt": "2026-03-06T14:36:00+08:00",
    "fromCache": true
  }
}
```

---

## 5. 交互状态机（按设计稿）

- 展开/折叠
  - 点击卡内“历史分析”触发 `expandedFundCode`
  - 同时只允许一个卡片展开
- 区间切换
  - 仅刷新 `HistoryExpandPanel`
  - 卡片上方净值与日内图不重置、不闪屏
- 历史区状态
  - `loading`：首次展开或切区间请求中
  - `ready`：`points.length > 0`
  - `empty`：请求成功但无点位
  - `error`：请求失败，可“重试”
- 全局状态（主列表区）
  - `empty list / no result / source error / stale`
- 关键交互细节
  - 清空搜索后恢复默认列表并回焦搜索框
  - 删除确认弹窗仅点击删除时出现；`Esc`/遮罩关闭；焦点回归触发按钮

---

## 6. 响应式还原规则（必须命中）

- 375 / 390：单列，历史展开区最小高度 `320`
- 768：单列宽卡，图表高度 `176`
- 1024：Web 两列，历史展开区最小高度 `340`
- 1440：Web 三列，历史展开区最小高度 `352`
- 所有断点要求：图表、坐标、指标区不重叠不裁切

---

## 7. 开发落地顺序（建议）

1. 补类型：`HistoryRange`、`FundHistoryAnalysis`、历史状态映射。
2. 新增历史接口：`GET /api/v1/funds/{code}/history`。
3. 前端实现：`HistoryExpandPanel` + `RangeSegment` + 指标卡。
4. 接入状态机：按 `loading/ready/empty/error` 条件渲染。
5. 交互打磨：局部刷新、AbortController 取消旧请求、弹窗焦点回归。
6. 断点验收：`375/390/768/1024/1440` 全量走查。

---

## 8. 验收清单（给开发与测试）

- [ ] 主页面无固定“示例状态块”
- [ ] Web/Mobile 均有默认态与展开态
- [ ] 五档区间切换只刷新展开区
- [ ] 历史区四态可触发并文案正确
- [ ] 全局四态可触发并文案正确
- [ ] 删除确认弹窗行为与焦点回归正确
- [ ] 五个断点无闪屏、无布局跳动、无裁切

