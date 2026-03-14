import { useEffect, useState } from 'react';
import {
  getSupplyRequests,
  updateSupplyRequestStatus,
  type SupplyRequest,
  type SupplyRequestStatus,
} from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Table, type Column } from '../components/Table';

const FILTERS: Array<SupplyRequestStatus | 'ALL'> = ['ALL', 'PENDING', 'IN_PROGRESS', 'DELIVERED'];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function ActionCell({ row, onUpdated }: { row: SupplyRequest; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false);
  const next: SupplyRequestStatus | null =
    row.status === 'PENDING' ? 'IN_PROGRESS' : row.status === 'IN_PROGRESS' ? 'DELIVERED' : null;

  if (!next) return <span className="text-xs text-gray-400">—</span>;

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await updateSupplyRequestStatus(row.id, next);
          onUpdated();
        } finally {
          setBusy(false);
        }
      }}
      className="text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40 transition-colors"
    >
      {busy ? '…' : next === 'IN_PROGRESS' ? 'Mark In Progress' : 'Mark Delivered'}
    </button>
  );
}

export default function SupplyRequests() {
  const [items, setItems] = useState<SupplyRequest[]>([]);
  const [filter, setFilter] = useState<SupplyRequestStatus | 'ALL'>('ALL');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (filter === 'ALL' ? getSupplyRequests() : getSupplyRequests(filter))
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

  const columns: Column<SupplyRequest>[] = [
    { header: 'User', render: (r) => r.user.name },
    { header: 'Location / Chat', render: (r) => r.clientLocation ?? r.chat.providerChatId },
    { header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { header: 'Date', render: (r) => formatDate(r.createdAt) },
    {
      header: 'Action',
      render: (r) => <ActionCell row={r} onUpdated={reload} />,
    },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Supply Requests</h2>
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
