import { useState } from 'react';
import type { Tab } from './types';
import Concerns from './views/Concerns';
import CrewOffRequests from './views/CrewOffRequests';
import Export from './views/Export';
import Overview from './views/Overview';
import SupplyRequests from './views/SupplyRequests';

type TabConfig = { id: Tab; label: string };

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'supply', label: 'Supply Requests' },
  { id: 'concerns', label: 'Concerns' },
  { id: 'crew-off', label: 'Crew-Off Requests' },
  { id: 'export', label: 'Export' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-6 h-14">
            <span className="text-sm font-semibold text-slate-100 shrink-0">🌲 Pinetree</span>
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
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'overview' && <Overview onTabChange={setTab} />}
        {tab === 'supply' && <SupplyRequests />}
        {tab === 'concerns' && <Concerns />}
        {tab === 'crew-off' && <CrewOffRequests />}
        {tab === 'export' && <Export />}
      </main>
    </div>
  );
}
