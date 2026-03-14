import { useEffect, useState } from 'react';
import {
  getCrewOffRequests,
  updateCrewOffStatus,
  type CrewOffRequest,
  type CrewOffStatus,
} from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Table, type Column } from '../components/Table';

const FILTERS: Array<CrewOffStatus | 'ALL'> = ['ALL', 'PENDING', 'APPROVED', 'DENIED'];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function ActionCell({ row, onUpdated }: { row: CrewOffRequest; onUpdated: () => void }) {
  const [busy, setBusy] = useState<CrewOffStatus | null>(null);

  const update = async (status: CrewOffStatus) => {
    setBusy(status);
    try {
      await updateCrewOffStatus(row.id, status);
      onUpdated();
    } finally {
      setBusy(null);
    }
  };

  if (row.status !== 'PENDING') return <span className="text-xs text-gray-400">—</span>;

  return (
    <div className="flex gap-2">
      <button
        disabled={busy !== null}
        onClick={() => void update('APPROVED')}
        className="text-xs px-2.5 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 transition-colors"
      >
        {busy === 'APPROVED' ? '…' : 'Approve'}
      </button>
      <button
        disabled={busy !== null}
        onClick={() => void update('DENIED')}
        className="text-xs px-2.5 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 transition-colors"
      >
        {busy === 'DENIED' ? '…' : 'Deny'}
      </button>
    </div>
  );
}

export default function CrewOffRequests() {
  const [items, setItems] = useState<CrewOffRequest[]>([]);
  const [filter, setFilter] = useState<CrewOffStatus | 'ALL'>('ALL');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (filter === 'ALL' ? getCrewOffRequests() : getCrewOffRequests(filter))
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

  const columns: Column<CrewOffRequest>[] = [
    { header: 'User', render: (r) => r.user.name },
    {
      header: 'Details',
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
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Crew-Off Requests</h2>
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
