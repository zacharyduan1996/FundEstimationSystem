import type { TrendPoint } from "@/lib/types";

type SparklineProps = {
  points: TrendPoint[];
  maskAmounts?: boolean;
};

type SparklineModel = {
  polyline: string;
  yMax: number;
  yMid: number;
  yMin: number;
  xAxisY: number;
  yAxisX: number;
};

const MARKET_OPEN_MINUTE = 9 * 60 + 30;
const LUNCH_START_MINUTE = 11 * 60 + 30;
const AFTERNOON_START_MINUTE = 13 * 60;
const MARKET_CLOSE_MINUTE = 15 * 60;
const TRADING_SPAN_MINUTES =
  LUNCH_START_MINUTE - MARKET_OPEN_MINUTE + (MARKET_CLOSE_MINUTE - AFTERNOON_START_MINUTE);

function getShanghaiMinuteOfDay(ts: string): number {
  const date = new Date(ts);
  const shanghaiHour = (date.getUTCHours() + 8) % 24;
  return shanghaiHour * 60 + date.getUTCMinutes();
}

function toTradingMinuteOffset(ts: string): number {
  const minute = getShanghaiMinuteOfDay(ts);

  if (minute <= MARKET_OPEN_MINUTE) {
    return 0;
  }

  if (minute < LUNCH_START_MINUTE) {
    return minute - MARKET_OPEN_MINUTE;
  }

  if (minute < AFTERNOON_START_MINUTE) {
    return LUNCH_START_MINUTE - MARKET_OPEN_MINUTE;
  }

  if (minute < MARKET_CLOSE_MINUTE) {
    return LUNCH_START_MINUTE - MARKET_OPEN_MINUTE + (minute - AFTERNOON_START_MINUTE);
  }

  return TRADING_SPAN_MINUTES;
}

function formatPrice(value: number): string {
  return `¥${value.toFixed(4)}`;
}

function buildModel(points: TrendPoint[], width: number, height: number): SparklineModel | null {
  if (points.length === 0) {
    return null;
  }

  const sorted = [...points].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const values = sorted.map((point) => point.estimatedNav);

  const valueMin = Math.min(...values);
  const valueMax = Math.max(...values);
  const valueRange = valueMax - valueMin;
  const padding = valueRange === 0 ? Math.max(Math.abs(valueMax) * 0.0015, 0.0005) : valueRange * 0.08;

  const yMin = valueMin - padding;
  const yMax = valueMax + padding;
  const yMid = (yMax + yMin) / 2;
  const yRange = yMax - yMin || 1;

  const yAxisX = 54;
  const xAxisY = height - 8;
  const plotTop = 8;
  const plotWidth = width - yAxisX - 10;
  const plotHeight = xAxisY - plotTop;

  const polyline = sorted
    .map((point) => {
      const minuteOffset = toTradingMinuteOffset(point.ts);
      const x = yAxisX + (minuteOffset / TRADING_SPAN_MINUTES) * plotWidth;
      const y = xAxisY - ((point.estimatedNav - yMin) / yRange) * plotHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  if (sorted.length === 1) {
    const singleY = xAxisY - ((sorted[0].estimatedNav - yMin) / yRange) * plotHeight;
    return {
      polyline: `${yAxisX.toFixed(2)},${singleY.toFixed(2)} ${(yAxisX + plotWidth).toFixed(2)},${singleY.toFixed(2)}`,
      yMax,
      yMid,
      yMin,
      xAxisY,
      yAxisX
    };
  }

  return { polyline, yMax, yMid, yMin, xAxisY, yAxisX };
}

export default function Sparkline({ points, maskAmounts = false }: SparklineProps) {
  const width = 640;
  const height = 140;
  const model = buildModel(points, width, height);
  const chartRight = width - 10;
  const chartTop = 8;
  const chartMid = (chartTop + (model?.xAxisY ?? height - 8)) / 2;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline" role="img" aria-label="日内走势曲线">
      <line x1={model?.yAxisX ?? 54} x2={model?.yAxisX ?? 54} y1={chartTop} y2={model?.xAxisY ?? height - 8} stroke="var(--border-subtle)" strokeWidth="1" />
      <line x1={model?.yAxisX ?? 54} x2={chartRight} y1={model?.xAxisY ?? height - 8} y2={model?.xAxisY ?? height - 8} stroke="var(--border-subtle)" strokeWidth="1" />
      <line x1={model?.yAxisX ?? 54} x2={chartRight} y1={chartTop} y2={chartTop} stroke="rgba(109,129,158,0.42)" strokeDasharray="4 4" strokeWidth="1" />
      <line x1={model?.yAxisX ?? 54} x2={chartRight} y1={chartMid} y2={chartMid} stroke="rgba(109,129,158,0.32)" strokeDasharray="4 4" strokeWidth="1" />

      {model ? (
        <>
          <text x="2" y={chartTop + 4} fill="var(--text-muted)" fontSize="11">
            {maskAmounts ? "****" : formatPrice(model.yMax)}
          </text>
          <text x="2" y={chartMid + 4} fill="var(--text-muted)" fontSize="11">
            {maskAmounts ? "****" : formatPrice(model.yMid)}
          </text>
          <text x="2" y={(model.xAxisY ?? height - 8) + 4} fill="var(--text-muted)" fontSize="11">
            {maskAmounts ? "****" : formatPrice(model.yMin)}
          </text>
          <polyline
            points={model.polyline}
            fill="none"
            stroke="var(--accent-line)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <text x="2" y={chartTop + 4} fill="var(--text-muted)" fontSize="11">
            --
          </text>
          <text x="2" y={chartMid + 4} fill="var(--text-muted)" fontSize="11">
            --
          </text>
          <text x="2" y={(height - 8) + 4} fill="var(--text-muted)" fontSize="11">
            --
          </text>
          <line
            x1={54}
            x2={chartRight}
            y1={chartMid}
            y2={chartMid}
            stroke="var(--text-muted)"
            strokeDasharray="8 6"
            strokeWidth="2"
          />
        </>
      )}
    </svg>
  );
}
