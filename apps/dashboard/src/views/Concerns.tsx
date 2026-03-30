import { useEffect, useState } from 'react';
import { getConcerns, updateConcernStatus, type Concern, type ConcernStatus } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Table, type Column } from '../components/Table';

const FILTERS: Array<ConcernStatus | 'ALL'> = ['ALL', 'OPEN', 'IN_PROGRESS', 'COMPLETED'];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function ActionCell({ row, onUpdated }: { row: Concern; onUpdated: () => void }) {
  const [busy, setBusy] = useState<ConcernStatus | null>(null);

  const update = async (status: ConcernStatus) => {
    setBusy(status);
    try {
      await updateConcernStatus(row.id, status);
      onUpdated();
    } finally {
      setBusy(null);
    }
  };

  if (row.status === 'COMPLETED') return <span className="text-xs text-gray-400">—</span>;

  return (
    <div className="flex gap-2">
      {row.status === 'OPEN' && (
        <button
          disabled={busy !== null}
          onClick={() => void update('IN_PROGRESS')}
          className="text-xs px-2.5 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40 transition-colors"
        >
          {busy === 'IN_PROGRESS' ? '…' : 'In Review'}
        </button>
      )}
      <button
        disabled={busy !== null}
        onClick={() => void update('COMPLETED')}
        className="text-xs px-2.5 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 transition-colors"
      >
        {busy === 'COMPLETED' ? '…' : 'Resolve'}
      </button>
    </div>
  );
}

export default function Concerns() {
  const [items, setItems] = useState<Concern[]>([]);
  const [filter, setFilter] = useState<ConcernStatus | 'ALL'>('ALL');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (filter === 'ALL' ? getConcerns() : getConcerns(filter))
      .then((r) => {
        if (!cancelled) setItems(r.items);
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
  }, [filter, refreshKey]);

  const columns: Column<Concern>[] = [
    { header: 'User', render: (r) => r.user.name },
    { header: 'Channel', render: (r) => r.chat.name ?? r.chat.providerChatId },
    {
      header: 'Concern',
      render: (r) => (
        <span title={r.text} className="block max-w-xs truncate">
          {r.text}
        </span>
      ),
    },
    { header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { header: 'Date', render: (r) => formatDate(r.createdAt) },
    {
      header: 'Action',
      render: (r) => <ActionCell row={r} onUpdated={reload} />,
    },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Concerns</h2>
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              filter === s
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'
            }`}
          >
            {s === 'ALL' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {loading ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200">
          <Table columns={columns} rows={items} keyFn={(r) => r.id} />
        </div>
      )}
    </div>
  );
}
