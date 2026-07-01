import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

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
  const [addOpen, setAddOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newSlug, setNewSlug] = useState('default');
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
    } catch (err) {}
  };

  const handleAddEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/endpoints', {
        projectSlug: newSlug,
        url: newUrl,
        method: 'GET',
      });
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
    } catch (err) {}
  };

  const handleLogout = () => {
    localStorage.removeItem('pantau_token');
    localStorage.removeItem('pantau_user');
    navigate('/login');
  };

  const upCount = endpoints.filter((e) => e.status === 'up').length;
  const downCount = endpoints.filter((e) => e.status === 'down').length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Pantau</h1>
            <p className="text-gray-500 text-sm">{user.email}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs bg-gray-800 px-3 py-1 rounded-full text-gray-400">
              {user.tier === 'free' ? 'Free (3 endpoints)' : user.tier}
            </span>
            <button onClick={handleLogout} className="text-gray-400 hover:text-white text-sm">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-sm">Endpoints</p>
            <p className="text-2xl font-bold">{endpoints.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-sm">Up</p>
            <p className="text-2xl font-bold text-green-500">{upCount}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-sm">Down</p>
            <p className="text-2xl font-bold text-red-500">{downCount}</p>
          </div>
        </div>

        {/* API Key */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Your API Key</h2>
            <button
              onClick={() => setShowKey(!showKey)}
              className="text-xs text-blue-400 hover:underline"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <code className="text-sm break-all text-gray-300 bg-gray-800 px-3 py-2 rounded block">
            {showKey ? apiKey : apiKey.slice(0, 12) + '...'}
          </code>
          <p className="text-xs text-gray-500 mt-2">
            Use this in <code className="text-blue-400">pantau.init({'{'}apiKey: '...'{'}'})</code>
          </p>
        </div>

        {/* SDK Setup */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
          <h2 className="font-semibold mb-2">Quick Setup</h2>
          <pre className="bg-gray-800 text-sm rounded-lg p-4 overflow-x-auto text-gray-300">
{`import pantau from 'pantau-js';

pantau.init({
  apiKey: '${apiKey.slice(0, 12)}...',
  serviceName: 'my-api',
});

app.use(pantau.middleware());
pantau.startHeartbeat();`}
          </pre>
        </div>

        {/* Endpoints */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Endpoints</h2>
          <button
            onClick={() => setAddOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
          >
            + Add URL
          </button>
        </div>

        {/* Add Modal */}
        {addOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Add Manual Monitor</h3>
              <form onSubmit={handleAddEndpoint} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Project Slug</label>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">URL</label>
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    required
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                    Cancel
                  </button>
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg">
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : endpoints.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-gray-400 mb-2">No endpoints yet</p>
            <p className="text-gray-600 text-sm">
              Install the SDK or add a manual URL monitor above
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {endpoints.map((ep) => (
              <div
                key={ep.id}
                className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      ep.status === 'up' ? 'bg-green-500' :
                      ep.status === 'down' ? 'bg-red-500' : 'bg-gray-600'
                    }`}
                  />
                  <span className="text-xs font-mono bg-gray-800 px-2 py-0.5 rounded text-gray-400">
                    {ep.method}
                  </span>
                  <span className="text-sm">{ep.path || ep.url}</span>
                  {ep.type === 'manual' && (
                    <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-500">URL</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${ep.status === 'up' ? 'text-green-400' : ep.status === 'down' ? 'text-red-400' : 'text-gray-500'}`}>
                    {ep.status.toUpperCase()}
                  </span>
                  <button
                    onClick={() => handleDelete(ep.id)}
                    className="text-gray-600 hover:text-red-400 text-sm"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
