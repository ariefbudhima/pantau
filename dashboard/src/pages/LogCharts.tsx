import { useMemo } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';

export interface LogStats {
  total: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p95Ms: number;
  minT: string | null;
  maxT: string | null;
  histogram: { t: string; ok: number; warn: number; err: number }[];
}

// Read CSS token values so charts follow the active theme.
function tok(name: string): string {
  if (typeof window === 'undefined') return '#888';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/**
 * Kibana Discover-style histogram + metric strip. Driven by server-side stats
 * over the FULL timeframe (not just the 500 rows in the table).
 */
export default function LogCharts({ stats }: { stats: LogStats | null }) {
  const buckets = useMemo(
    () =>
      (stats?.histogram || []).map((b) => ({
        ...b,
        label: new Date(b.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      })),
    [stats]
  );

  const span = useMemo(() => {
    if (!stats?.minT || !stats?.maxT) return '';
    const secs = Math.round((new Date(stats.maxT).getTime() - new Date(stats.minT).getTime()) / 1000);
    if (secs < 120) return `${secs}s`;
    if (secs < 7200) return `${Math.round(secs / 60)}m`;
    if (secs < 172800) return `${Math.round(secs / 3600)}h`;
    return `${Math.round(secs / 86400)}d`;
  }, [stats]);

  if (!stats || stats.total === 0) {
    return (
      <div className="border border-line rounded-lg bg-panel mb-3 py-6 text-center text-faint text-sm">
        No events in this time range.
      </div>
    );
  }

  return (
    <div className="border border-line rounded-lg bg-panel mb-3">
      <div className="grid grid-cols-4 divide-x divide-line border-b border-line">
        <Metric label="Events" value={stats.total.toLocaleString()} sub={span ? `over ${span}` : ''} />
        <Metric label="Error rate" value={`${stats.errorRate}%`} sub={`${stats.errors} errors`} tone={stats.errorRate > 5 ? 'err' : undefined} />
        <Metric label="Avg latency" value={`${stats.avgMs}ms`} />
        <Metric label="p95 latency" value={`${stats.p95Ms}ms`} tone={stats.p95Ms > 1000 ? 'warn' : undefined} />
      </div>
      <div className="h-28 px-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} barCategoryGap={1}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: tok('--muted') }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={{ stroke: tok('--line') }}
            />
            <Tooltip
              cursor={{ fill: tok('--panel-2') }}
              contentStyle={{
                background: tok('--panel'), border: `1px solid ${tok('--line')}`,
                borderRadius: 8, fontSize: 11, color: tok('--text'),
              }}
            />
            <Bar dataKey="ok" name="2xx/3xx" stackId="s" fill={tok('--ok')} />
            <Bar dataKey="warn" name="4xx" stackId="s" fill={tok('--warn')} />
            <Bar dataKey="err" name="5xx" stackId="s" fill={tok('--err')} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'err' | 'warn' }) {
  const color = tone === 'err' ? 'text-err' : tone === 'warn' ? 'text-warn' : 'text-text';
  return (
    <div className="px-4 py-2.5">
      <p className="text-faint text-[10px] uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-faint text-[10px]">{sub}</p>}
    </div>
  );
}
