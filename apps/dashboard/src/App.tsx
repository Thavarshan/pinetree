import { useState } from 'react';
import type { Tab } from './types';
import Overview from './views/Overview';
import SupplyRequests from './views/SupplyRequests';
import Concerns from './views/Concerns';
import CrewOffRequests from './views/CrewOffRequests';
import Export from './views/Export';

type TabConfig = { id: Tab; label: string };

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'supply', label: 'Supply Requests' },
  { id: 'concerns', label: 'Concerns' },
  { id: 'crew-off', label: 'Crew-Off Requests' },
  { id: 'export', label: 'Export' },
];

export default function App() {
  const [apiKey, setApiKey] = useState<string>(
    () => sessionStorage.getItem('pinetree_api_key') ?? '',
  );
  const [keyInput, setKeyInput] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  if (!apiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 w-full max-w-sm">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">🌲 Pinetree Admin</h1>
          <p className="text-sm text-gray-500 mb-6">Enter your API key to continue.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const key = keyInput.trim();
              if (!key) return;
              sessionStorage.setItem('pinetree_api_key', key);
              setApiKey(key);
            }}
          >
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 mb-4"
              placeholder="your-api-key"
              autoFocus
            />
            <button
              type="submit"
              disabled={!keyInput.trim()}
              className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-6 h-14">
            <span className="text-sm font-semibold text-slate-100 shrink-0">🌲 Pinetree Admin</span>
            <nav className="flex gap-1 flex-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                    tab === t.id
                      ? 'bg-white/20 text-white font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <button
              onClick={() => {
                sessionStorage.removeItem('pinetree_api_key');
                setApiKey('');
                setKeyInput('');
              }}
              className="text-slate-400 hover:text-white text-sm transition-colors shrink-0"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'overview' && <Overview apiKey={apiKey} onTabChange={setTab} />}
        {tab === 'supply' && <SupplyRequests apiKey={apiKey} />}
        {tab === 'concerns' && <Concerns apiKey={apiKey} />}
        {tab === 'crew-off' && <CrewOffRequests apiKey={apiKey} />}
        {tab === 'export' && <Export apiKey={apiKey} />}
      </main>
    </div>
  );
}
