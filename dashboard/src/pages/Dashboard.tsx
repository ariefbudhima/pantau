import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import LogViewer from './LogViewer';
import { useTheme } from '../useTheme';

interface Endpoint {
  id: number;
  name: string;
  method: string;
  path: string;
  type: string;
  url: string;
  status: string;
  last_checked_at: string;
  project_name: string;
}

export default function Dashboard() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newSlug, setNewSlug] = useState('default');
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem('pantau_user') || '{}');

  useEffect(() => {
    loadEndpoints();
    loadApiKey();
  }, []);

  const loadEndpoints = async () => {
    try {
      const res = await api.get('/endpoints');
      setEndpoints(res.data.endpoints);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadApiKey = async () => {
    try {
      const res = await api.get('/auth/me');
      setApiKey(res.data.user.api_key);
    } catch { /* ignore */ }
  };

  const handleAddEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/endpoints', { projectSlug: newSlug, url: newUrl, method: 'GET' });
      setAddOpen(false);
      setNewUrl('');
      loadEndpoints();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this endpoint?')) return;
    try {
      await api.delete(`/endpoints/${id}`);
      loadEndpoints();
    } catch { /* ignore */ }
  };

  const handleLogout = () => {
    localStorage.removeItem('pantau_token');
    localStorage.removeItem('pantau_user');
    navigate('/login');
  };

  const upCount = endpoints.filter((e) => e.status === 'up').length;
  const downCount = endpoints.filter((e) => e.status === 'down').length;

  return (
    <div className="min-h-screen bg-surface text-text">
      {/* Header — thin bar */}
      <header className="border-b border-line sticky top-0 bg-surface/90 backdrop-blur z-20">
        <div className="max-w-7xl mx-auto px-5 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-semibold tracking-tight">pantau</span>
            <span className="text-faint text-xs hidden sm:inline">·</span>
            <span className="text-muted text-xs hidden sm:inline truncate">{user.email}</span>
          </div>
          <div className="flex items-center gap-3 text-xs shrink-0">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="w-2 h-2 rounded-full bg-ok" />{upCount}
              <span className="w-2 h-2 rounded-full bg-err ml-2.5" />{downCount}
            </span>
            <button onClick={toggleTheme} className="text-muted hover:text-text w-6 text-center" title="Toggle theme">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button onClick={handleLogout} className="text-muted hover:text-text">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-5 space-y-5">
        {/* Endpoints — dense list */}
        <section className="border border-line rounded-lg bg-panel">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Endpoints</h2>
              <span className="text-xs text-faint tabular-nums">{endpoints.length}</span>
              <span className="text-xs text-faint">
                · {user.tier === 'free' ? 'Free (3 max)' : user.tier}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSetupOpen((s) => !s)}
                className="text-xs text-muted hover:text-text border border-line rounded px-2 py-1"
              >
                Setup & API key
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="text-xs text-accent hover:underline"
              >
                + Add URL
              </button>
            </div>
          </div>

          {/* Setup drawer */}
          {setupOpen && (
            <div className="px-3 py-3 border-b border-line bg-surface space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-faint uppercase tracking-wide w-16">API key</span>
                <code className="font-mono text-text bg-panel border border-line rounded px-2 py-1 flex-1 break-all">
                  {showKey ? apiKey : apiKey.slice(0, 12) + '…'}
                </code>
                <button onClick={() => setShowKey(!showKey)} className="text-accent">
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <pre className="bg-panel border border-line rounded p-3 text-[11px] overflow-x-auto text-muted font-mono">
{`import pantau from 'pantau-js';
pantau.init({ apiKey: '${apiKey.slice(0, 12)}…', serviceName: 'my-api', capture: { body: true } });
app.use(pantau.middleware());
pantau.startHeartbeat();`}
              </pre>
            </div>
          )}

          {loading ? (
            <p className="text-muted text-sm px-3 py-6">Loading…</p>
          ) : endpoints.length === 0 ? (
            <p className="text-faint text-sm px-3 py-8 text-center">
              No endpoints yet. Install the SDK or add a manual URL monitor.
            </p>
          ) : (
            <div className="divide-y divide-line max-h-72 overflow-y-auto">
              {endpoints.map((ep) => (
                <div key={ep.id} className="flex items-center gap-3 px-3 py-1.5 text-sm hover:bg-panel-2 group">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      ep.status === 'up' ? 'bg-ok' : ep.status === 'down' ? 'bg-err' : 'bg-faint'
                    }`}
                  />
                  <span className="font-mono text-[11px] text-muted w-12 shrink-0">{ep.method}</span>
                  <span className="font-mono text-text truncate flex-1" title={ep.path || ep.url}>
                    {ep.path || ep.url}
                  </span>
                  {ep.type === 'manual' && (
                    <span className="text-[10px] text-faint border border-line rounded px-1">URL</span>
                  )}
                  <span className={`text-[11px] tabular-nums w-10 text-right ${
                    ep.status === 'up' ? 'text-ok' : ep.status === 'down' ? 'text-err' : 'text-faint'
                  }`}>
                    {ep.status}
                  </span>
                  <button
                    onClick={() => handleDelete(ep.id)}
                    className="text-faint hover:text-err opacity-0 group-hover:opacity-100 w-4"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Logs + charts */}
        <LogViewer />
      </main>

      {/* Add modal */}
      {addOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAddOpen(false)}>
          <div className="bg-panel border border-line rounded-lg p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Add manual monitor</h3>
            <form onSubmit={handleAddEndpoint} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Project slug</label>
                <input
                  type="text" value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
                  className="w-full bg-surface border border-line rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">URL</label>
                <input
                  type="url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://example.com" required
                  className="w-full bg-surface border border-line rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setAddOpen(false)} className="px-3 py-1.5 text-sm text-muted hover:text-text">
                  Cancel
                </button>
                <button type="submit" className="bg-accent text-white text-sm px-3 py-1.5 rounded">
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
