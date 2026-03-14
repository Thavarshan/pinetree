import { useState } from 'react';
import { downloadExport, type ExportParams } from '../api';

type Mode = 'single' | 'range';

export default function Export({ apiKey }: { apiKey: string }) {
  const [mode, setMode] = useState<Mode>('single');
  const [singleDate, setSingleDate] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [downloading, setDownloading] = useState<'csv' | 'xlsx' | null>(null);
  const [error, setError] = useState('');

  const isReady = mode === 'single' ? Boolean(singleDate) : Boolean(fromDate) && Boolean(toDate);

  const buildParams = (): ExportParams =>
    mode === 'single' ? { date: singleDate } : { from: fromDate, to: toDate };

  const handleDownload = async (format: 'csv' | 'xlsx') => {
    setError('');
    setDownloading(format);
    try {
      await downloadExport(apiKey, format, buildParams());
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Export</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Mode toggle */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Date range</p>
          <div className="flex gap-3">
            {(['single', 'range'] as const).map((m) => (
              <label
                key={m}
                className="flex items-center gap-2 cursor-pointer text-sm text-gray-700"
              >
                <input
                  type="radio"
                  name="mode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="accent-slate-800"
                />
                {m === 'single' ? 'Single day' : 'Date range'}
              </label>
            ))}
          </div>
        </div>

        {/* Date inputs */}
        {mode === 'single' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={singleDate}
              onChange={(e) => setSingleDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
        ) : (
          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                min={fromDate}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-1">
          <button
            disabled={!isReady || downloading !== null}
            onClick={() => void handleDownload('csv')}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            {downloading === 'csv' ? 'Downloading…' : '⬇ Download CSV'}
          </button>
          <button
            disabled={!isReady || downloading !== null}
            onClick={() => void handleDownload('xlsx')}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {downloading === 'xlsx' ? 'Downloading…' : '⬇ Download XLSX'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>
    </div>
  );
}
