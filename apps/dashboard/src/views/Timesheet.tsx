import { useEffect, useState } from 'react';
import { type DailySummaryRow, type TimesheetParams, getTimesheet } from '../api';

type Mode = 'single' | 'range';

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtWorked(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function Timesheet() {
  const today = toDateString(new Date());
  const [mode, setMode] = useState<Mode>('single');
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<DailySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const params: TimesheetParams =
      mode === 'single' ? { date } : { from, to };

    void getTimesheet(params)
      .then((res) => {
        if (!cancelled) setRows(res.items);
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
  }, [mode, date, from, to]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Timesheet</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('single')}
              className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                mode === 'single'
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-slate-400'
              }`}
            >
              Single day
            </button>
            <button
              onClick={() => setMode('range')}
              className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                mode === 'range'
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-slate-400'
              }`}
            >
              Date range
            </button>
          </div>
        </div>

        {mode === 'single' ? (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
        ) : (
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">No records found.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Sign In</th>
                <th className="px-4 py-3">Sign Out</th>
                <th className="px-4 py-3">Break</th>
                <th className="px-4 py-3">Worked</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-600">{row.date}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{row.userName}</td>
                  <td className="px-4 py-3 text-gray-600">{row.shiftStartTime ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{row.shiftEndTime ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.totalBreakMinutes > 0 ? `${row.totalBreakMinutes}m` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.totalWorkedMinutes > 0 ? fmtWorked(row.totalWorkedMinutes) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {row.incomplete ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                        Incomplete
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                        Complete
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
