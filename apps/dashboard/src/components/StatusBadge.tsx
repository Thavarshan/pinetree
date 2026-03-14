const colourMap: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  OPEN: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  DENIED: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = colourMap[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
