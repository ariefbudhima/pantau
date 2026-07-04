import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import api from '../api';
import LogCharts, { type LogStats } from './LogCharts';

interface Log {
  id: number;
  method: string;
  path: string;
  status_code: number;
  response_time_ms: number;
  error_message: string | null;
  logged_at: string;
  endpoint_name: string | null;
  request_body: unknown;
  response_body: unknown;
  headers: Record<string, unknown> | null;
}

const STATUS_FILTERS = ['', '2xx', '4xx', '5xx'];
const METHODS = ['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Timeframe options → milliseconds lookback. null = all time.
const TIMEFRAMES: { label: string; ms: number | null }[] = [
  { label: '5m', ms: 300_000 },
  { label: '10m', ms: 600_000 },
  { label: '15m', ms: 900_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '4h', ms: 14_400_000 },
  { label: '8h', ms: 28_800_000 },
  { label: '12h', ms: 43_200_000 },
  { label: '24h', ms: 86_400_000 },
  { label: '2d', ms: 172_800_000 },
  { label: '7d', ms: 604_800_000 },
  { label: '30d', ms: 2_592_000_000 },
  { label: 'All', ms: null },
];

type SortKey = 'logged_at' | 'status_code' | 'response_time_ms' | 'path';
type SortDir = 'asc' | 'desc';

function statusColor(code: number): string {
  if (code >= 500) return 'text-err';
  if (code >= 400) return 'text-warn';
  if (code >= 200 && code < 300) return 'text-ok';
  return 'text-muted';
}

function methodColor(m: string): string {
  switch (m) {
    case 'GET': return 'text-accent';
    case 'POST': return 'text-ok';
    case 'PUT': case 'PATCH': return 'text-warn';
    case 'DELETE': return 'text-err';
    default: return 'text-muted';
  }
}

const REDACTED = '[REDACTED]';

/**
 * Flatten a nested object/array into { path, value, masked } rows so the detail
 * view can show EVERY key (structure stays visible) while sensitive values
 * render as a badge. Keys are always shown; only values are hidden.
 */
interface Row { path: string; value: string; masked: boolean }
function flatten(value: unknown, prefix = '', out: Row[] = []): Row[] {
  if (value === null || value === undefined) {
    out.push({ path: prefix || '(root)', value: 'null', masked: false });
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out.push({ path: prefix, value: '[]', masked: false });
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.push({ path: prefix, value: '{}', masked: false });
    for (const [k, v] of entries) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  const str = String(value);
  out.push({ path: prefix || '(value)', value: str, masked: str === REDACTED });
  return out;
}

type BodyView = 'table' | 'json';

/** Pretty JSON with [REDACTED] highlighted. */
function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <pre className="bg-surface border border-line rounded-md p-2 text-[11px] font-mono text-text max-h-60 overflow-auto">
      {text.split(REDACTED).map((part, i, arr) => (
        <span key={i}>
          {part}
          {i < arr.length - 1 && <span className="text-warn font-semibold">{REDACTED}</span>}
        </span>
      ))}
    </pre>
  );
}

/** Key-value table: every key shown, sensitive value → masked badge. */
function TableView({ value }: { value: unknown }) {
  const rows = flatten(value);
  return (
    <div className="bg-surface border border-line rounded-md divide-y divide-line max-h-60 overflow-y-auto">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2 px-2 py-1 text-[11px] font-mono">
          <span className="text-muted shrink-0 max-w-[45%] truncate" title={r.path}>{r.path}</span>
          <span className="text-faint">:</span>
          {r.masked ? (
            <span className="text-warn bg-warn/10 px-1.5 rounded text-[10px] font-semibold">masked</span>
          ) : (
            <span className="text-text break-all">{r.value}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One body block; renders as table or json per shared `view`. */
function BodyDetail({ title, value, view }: { title: string; value: unknown; view: BodyView }) {
  return (
    <div className="min-w-0">
      <p className="text-faint text-[10px] uppercase tracking-wide mb-1.5">{title}</p>
      {value == null ? (
        <p className="text-faint italic text-xs bg-surface border border-line rounded-md px-2 py-3 text-center">
          not captured
        </p>
      ) : view === 'json' ? (
        <JsonView value={value} />
      ) : (
        <TableView value={value} />
      )}
    </div>
  );
}

export default function LogViewer() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');   // one box: path or PII
  const [piiHash, setPiiHash] = useState(''); // resolved hash when in PII mode
  const [live, setLive] = useState(true);

  // An '@' or explicit "pii:" prefix means "search hashed PII"; else path.
  const searchMode: 'path' | 'pii' = /@|^pii:/i.test(search) ? 'pii' : 'path';
  const piiTerm = search.replace(/^pii:/i, '').trim();
  const q = searchMode === 'path' ? search.trim() : '';
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('logged_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [timeframe, setTimeframe] = useState('24h');
  const [bodyView, setBodyView] = useState<BodyView>(
    () => (localStorage.getItem('pantau_bodyview') as BodyView) || 'table'
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { localStorage.setItem('pantau_bodyview', bodyView); }, [bodyView]);

  // In PII mode, resolve the typed term to its searchable hash (debounced). The
  // raw term is hashed server-side with the account key; we only search the hash.
  useEffect(() => {
    if (searchMode !== 'pii' || !piiTerm) { setPiiHash(''); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/logs/hash', { params: { value: piiTerm } });
        setPiiHash(res.data.hash);
      } catch { setPiiHash(''); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchMode, piiTerm]);

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '500' };
      if (status) params.status = status;
      if (method) params.method = method;
      if (q) params.q = q;
      if (piiHash) params.bodyq = piiHash;
      const tf = TIMEFRAMES.find((t) => t.label === timeframe);
      if (tf?.ms) params.since = new Date(Date.now() - tf.ms).toISOString();
      // Table shows most-recent 500; stats aggregate the FULL window.
      const [logsRes, statsRes] = await Promise.all([
        api.get('/logs', { params }),
        api.get('/logs/stats', { params }),
      ]);
      setLogs(logsRes.data.logs);
      setStats(statsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [status, method, q, piiHash, timeframe]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!live) return;
    timer.current = setInterval(load, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [live, load]);

  // Filters run server-side; sort is client-side over the returned page.
  const visible = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...logs].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av! < bv!) return -1 * dir;
      if (av! > bv!) return 1 * dir;
      return 0;
    });
  }, [logs, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div>
      {/* Charts — driven by full-window server stats */}
      <LogCharts stats={stats} />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Logs</h2>
          <span className="text-xs text-faint tabular-nums">
            {stats && stats.total > visible.length ? `${visible.length} of ${stats.total.toLocaleString()}` : visible.length}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="bg-panel border border-line rounded-md px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
            title="Time range"
          >
            {TIMEFRAMES.map((t) => <option key={t.label} value={t.label}>{t.label === 'All' ? 'All time' : `Last ${t.label}`}</option>)}
          </select>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="bg-panel border border-line rounded-md px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
          >
            {METHODS.map((m) => <option key={m} value={m}>{m || 'All methods'}</option>)}
          </select>
          <div className="flex bg-panel border border-line rounded-md p-0.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setStatus(f)}
                className={`text-xs px-2.5 py-1 rounded transition ${
                  status === f ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'
                }`}
              >
                {f || 'All'}
              </button>
            ))}
          </div>
          {/* One smart search: an '@' (or explicit "pii:") searches hashed PII,
              anything else searches the path. */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search path or email…"
              title="Type a path (/login) to search routes, or an email to find hashed PII. Raw PII is never stored."
              className={`bg-panel border rounded-md pl-3 pr-12 py-1.5 text-sm text-text w-56 focus:outline-none focus:border-accent ${
                searchMode === 'pii' ? 'border-accent/50' : 'border-line'
              }`}
            />
            {search && (
              <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 rounded font-semibold ${
                searchMode === 'pii' ? 'bg-accent/15 text-accent' : 'bg-panel-2 text-muted'
              }`}>
                {searchMode}
              </span>
            )}
          </div>
          <button
            onClick={() => setLive(!live)}
            className={`text-xs px-2.5 py-1.5 rounded-md border flex items-center gap-1.5 ${
              live ? 'border-ok/30 text-ok bg-ok/5' : 'border-line text-muted'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-ok animate-pulse' : 'bg-faint'}`} />
            {live ? 'Live' : 'Paused'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted text-sm py-8 text-center">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-10 text-faint text-sm border border-line rounded-lg bg-panel">
          No logs match. Install the SDK and send traffic, or clear filters.
        </div>
      ) : (
        // Fixed-height container: header sticky, body scrolls (ELK Discover style).
        <div className="border border-line rounded-lg overflow-hidden bg-panel">
          <div className="max-h-[34rem] overflow-y-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-panel z-10">
                <tr className="text-faint text-[11px] border-b border-line">
                  <Th onClick={() => toggleSort('logged_at')} label={`Time${sortArrow('logged_at')}`} />
                  <Th label="Method" />
                  <Th onClick={() => toggleSort('path')} label={`Path${sortArrow('path')}`} />
                  <Th onClick={() => toggleSort('status_code')} label={`Status${sortArrow('status_code')}`} align="right" />
                  <Th onClick={() => toggleSort('response_time_ms')} label={`Latency${sortArrow('response_time_ms')}`} align="right" />
                  <Th label="Error" />
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {visible.map((l) => {
                  const hasDetail = l.request_body != null || l.response_body != null || l.headers != null;
                  const open = expanded === l.id;
                  return (
                    <Fragment key={l.id}>
                      <tr
                        onClick={() => hasDetail && setExpanded(open ? null : l.id)}
                        className={`border-b border-line/60 hover:bg-panel-2 ${hasDetail ? 'cursor-pointer' : ''} ${open ? 'bg-panel-2' : ''}`}
                      >
                        <td className="py-1.5 px-3 text-muted whitespace-nowrap">
                          <span className="text-faint mr-1 inline-block w-2">{hasDetail ? (open ? '▾' : '▸') : ''}</span>
                          {new Date(l.logged_at).toLocaleTimeString()}
                        </td>
                        <td className={`py-1.5 px-3 font-semibold ${methodColor(l.method)}`}>{l.method}</td>
                        <td className="py-1.5 px-3 text-text max-w-xs truncate" title={l.path}>{l.path}</td>
                        <td className={`py-1.5 px-3 text-right font-semibold tabular-nums ${statusColor(l.status_code)}`}>{l.status_code}</td>
                        <td className="py-1.5 px-3 text-right text-muted tabular-nums">{l.response_time_ms}ms</td>
                        <td className="py-1.5 px-3 text-err/80 max-w-[10rem] truncate" title={l.error_message || ''}>
                          {l.error_message || ''}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-surface">
                          <td colSpan={6} className="px-4 py-3">
                            {/* JSON ↔ Table toggle */}
                            <div className="flex justify-end mb-2">
                              <div className="flex bg-panel border border-line rounded-md p-0.5 text-[11px]">
                                {(['table', 'json'] as BodyView[]).map((v) => (
                                  <button
                                    key={v}
                                    onClick={() => setBodyView(v)}
                                    className={`px-2.5 py-0.5 rounded capitalize ${
                                      bodyView === v ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'
                                    }`}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="grid md:grid-cols-3 gap-4">
                              <BodyDetail title="Request body" value={l.request_body} view={bodyView} />
                              <BodyDetail title="Response body" value={l.response_body} view={bodyView} />
                              <BodyDetail title="Headers" value={l.headers} view={bodyView} />
                            </div>
                            <p className="text-faint text-[10px] mt-2">
                              Keys are always shown so you can see the payload shape. Sensitive values are
                              <span className="text-warn"> masked</span> in the SDK before sending — Pantau never receives raw values.
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ label, onClick, align = 'left' }: { label: string; onClick?: () => void; align?: 'left' | 'right' }) {
  return (
    <th
      onClick={onClick}
      className={`font-medium py-2 px-3 ${align === 'right' ? 'text-right' : 'text-left'} uppercase tracking-wide ${onClick ? 'cursor-pointer hover:text-text select-none' : ''}`}
    >
      {label}
    </th>
  );
}
