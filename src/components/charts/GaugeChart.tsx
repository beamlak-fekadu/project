'use client';

import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
} from 'chart.js';
import { useChartTheme } from './useChartTheme';

ChartJS.register(ArcElement, Tooltip);

interface GaugeChartProps {
  value: number;
  label?: string;
  color?: string;
  size?: number;
}

export default function GaugeChart({
  value,
  label,
  color = 'rgb(37, 99, 235)',
  size = 200,
}: GaugeChartProps) {
  const chartTheme = useChartTheme();
  const clamped = Math.min(100, Math.max(0, value));
  const formattedValue = Number(clamped).toFixed(1);
  const remainder = 100 - clamped;

  const data = {
    datasets: [
      {
        data: [clamped, remainder],
        backgroundColor: [color, chartTheme.gridColor],
        borderColor: 'transparent',
        circumference: 260,
        rotation: 230,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: true,
    cutout: '78%',
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
  };

  return (
    <div
      className="relative flex flex-col items-center justify-center"
      style={{ width: size, height: size }}
    >
      <Doughnut data={data} options={options} />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[var(--foreground)]">
          {formattedValue}%
        </span>
        {label && (
          <span className="mt-1 text-sm text-[var(--text-muted)]">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
