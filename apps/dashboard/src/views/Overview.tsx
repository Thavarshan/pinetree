import { useEffect, useState } from 'react';
import { getConcerns, getCrewOffRequests, getSupplyRequests } from '../api';
import type { Tab } from '../types';

interface Counts {
  concerns: number;
  supply: number;
  crewOff: number;
}

interface CardConfig {
  label: string;
  count: number;
  tab: Tab;
  colour: string;
}

export default function Overview({ onTabChange }: { onTabChange: (tab: Tab) => void }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void Promise.all([
      getConcerns('OPEN'),
      getSupplyRequests('PENDING'),
      getCrewOffRequests('PENDING'),
    ])
      .then(([c, s, cr]) => {
        if (!cancelled)
          setCounts({
            concerns: c.items.length,
            supply: s.items.length,
            crewOff: cr.items.length,
          });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: CardConfig[] = [
    {
      label: 'Open Concerns',
      count: counts?.concerns ?? 0,
      tab: 'concerns',
      colour: 'text-red-600',
    },
    {
      label: 'Pending Supply Requests',
      count: counts?.supply ?? 0,
      tab: 'supply',
      colour: 'text-amber-600',
    },
    {
      label: 'Pending Crew-Off Requests',
      count: counts?.crewOff ?? 0,
      tab: 'crew-off',
      colour: 'text-blue-600',
    },
  ];

  if (loading) {
    return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Overview</h2>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((card) => (
          <button
            key={card.tab}
            onClick={() => onTabChange(card.tab)}
            className="bg-white rounded-xl border border-gray-200 p-6 text-left hover:border-slate-400 hover:shadow-sm transition-all"
          >
            <p className="text-sm text-gray-500 mb-2">{card.label}</p>
            <p className={`text-4xl font-bold ${card.colour}`}>{card.count}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
