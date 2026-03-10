import type { HistoryPoint } from "@/lib/types";

type HistoryLineChartProps = {
  points: HistoryPoint[];
  maskAmounts?: boolean;
};

type HistoryChartModel = {
  polyline: string;
  yMax: number;
  yMid: number;
  yMin: number;
  xAxisY: number;
  yAxisX: number;
};

function formatPrice(value: number): string {
  return `¥${value.toFixed(4)}`;
}

function buildModel(points: HistoryPoint[], width: number, height: number): HistoryChartModel | null {
  if (points.length === 0) {
    return null;
  }

  const sorted = [...points].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const values = sorted.map((point) => point.nav);
  const valueMin = Math.min(...values);
  const valueMax = Math.max(...values);
  const valueRange = valueMax - valueMin;
  const padding = valueRange === 0 ? Math.max(Math.abs(valueMax) * 0.0015, 0.0005) : valueRange * 0.08;

  const yMin = valueMin - padding;
  const yMax = valueMax + padding;
  const yMid = (yMin + yMax) / 2;
  const yRange = yMax - yMin || 1;

  const yAxisX = 54;
  const xAxisY = height - 8;
  const plotTop = 8;
  const plotWidth = width - yAxisX - 10;
  const plotHeight = xAxisY - plotTop;

  if (sorted.length === 1) {
    const pointY = xAxisY - ((sorted[0]!.nav - yMin) / yRange) * plotHeight;
    return {
      polyline: `${yAxisX.toFixed(2)},${pointY.toFixed(2)} ${(yAxisX + plotWidth).toFixed(2)},${pointY.toFixed(2)}`,
      yMax,
      yMid,
      yMin,
      xAxisY,
      yAxisX
    };
  }

  const divisor = sorted.length - 1;
  const polyline = sorted
    .map((point, index) => {
      const x = yAxisX + (index / divisor) * plotWidth;
      const y = xAxisY - ((point.nav - yMin) / yRange) * plotHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return { polyline, yMax, yMid, yMin, xAxisY, yAxisX };
}

export default function HistoryLineChart({ points, maskAmounts = false }: HistoryLineChartProps) {
  const width = 640;
  const height = 140;
  const model = buildModel(points, width, height);
  const chartRight = width - 10;
  const chartTop = 8;
  const chartMid = (chartTop + (model?.xAxisY ?? height - 8)) / 2;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline" role="img" aria-label="历史净值走势曲线">
      <line
        x1={model?.yAxisX ?? 54}
        x2={model?.yAxisX ?? 54}
        y1={chartTop}
        y2={model?.xAxisY ?? height - 8}
        stroke="var(--border-subtle)"
        strokeWidth="1"
      />
      <line
        x1={model?.yAxisX ?? 54}
        x2={chartRight}
        y1={model?.xAxisY ?? height - 8}
        y2={model?.xAxisY ?? height - 8}
        stroke="var(--border-subtle)"
        strokeWidth="1"
      />
      <line
        x1={model?.yAxisX ?? 54}
        x2={chartRight}
        y1={chartTop}
        y2={chartTop}
        stroke="rgba(109,129,158,0.42)"
        strokeDasharray="4 4"
        strokeWidth="1"
      />
      <line
        x1={model?.yAxisX ?? 54}
        x2={chartRight}
        y1={chartMid}
        y2={chartMid}
        stroke="rgba(109,129,158,0.32)"
        strokeDasharray="4 4"
        strokeWidth="1"
      />

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
