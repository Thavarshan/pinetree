const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';

function apiHeaders(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
}

async function apiGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: apiHeaders(apiKey) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data: unknown = await res.json();
  return data as T;
}

async function apiPatch<T>(path: string, apiKey: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: apiHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data: unknown = await res.json();
  return data as T;
}

// ---- Types ----

export type SupplyRequestStatus = 'PENDING' | 'IN_PROGRESS' | 'DELIVERED';
export type ConcernStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
export type CrewOffStatus = 'PENDING' | 'APPROVED' | 'DENIED';

export interface SupplyRequest {
  id: string;
  userId: string;
  chatId: string;
  clientLocation: string | null;
  status: SupplyRequestStatus;
  createdAt: string;
  updatedAt: string;
  user: { name: string };
  chat: { providerChatId: string };
}

export interface Concern {
  id: string;
  userId: string;
  chatId: string;
  text: string;
  conversationId: string;
  provider: string;
  status: ConcernStatus;
  createdAt: string;
  updatedAt: string;
  user: { name: string };
}

export interface CrewOffRequest {
  id: string;
  userId: string;
  chatId: string;
  text: string;
  status: CrewOffStatus;
  createdAt: string;
  updatedAt: string;
  user: { name: string };
}

// ---- Supply Requests ----

export function getSupplyRequests(apiKey: string): Promise<{ ok: boolean; items: SupplyRequest[] }>;
export function getSupplyRequests(
  apiKey: string,
  status: SupplyRequestStatus,
): Promise<{ ok: boolean; items: SupplyRequest[] }>;
export function getSupplyRequests(apiKey: string, status?: SupplyRequestStatus) {
  const qs = status !== undefined ? `?status=${status}` : '';
  return apiGet<{ ok: boolean; items: SupplyRequest[] }>(`/supply-requests${qs}`, apiKey);
}

export function updateSupplyRequestStatus(apiKey: string, id: string, status: SupplyRequestStatus) {
  return apiPatch<{ ok: boolean; item: SupplyRequest }>(`/supply-requests/${id}/status`, apiKey, {
    status,
  });
}

// ---- Concerns ----

export function getConcerns(apiKey: string): Promise<{ ok: boolean; items: Concern[] }>;
export function getConcerns(
  apiKey: string,
  status: ConcernStatus,
): Promise<{ ok: boolean; items: Concern[] }>;
export function getConcerns(apiKey: string, status?: ConcernStatus) {
  const qs = status !== undefined ? `?status=${status}` : '';
  return apiGet<{ ok: boolean; items: Concern[] }>(`/concerns${qs}`, apiKey);
}

export function updateConcernStatus(apiKey: string, id: string, status: ConcernStatus) {
  return apiPatch<{ ok: boolean; item: Concern }>(`/concerns/${id}/status`, apiKey, { status });
}

// ---- Crew-Off Requests ----

export function getCrewOffRequests(
  apiKey: string,
): Promise<{ ok: boolean; items: CrewOffRequest[] }>;
export function getCrewOffRequests(
  apiKey: string,
  status: CrewOffStatus,
): Promise<{ ok: boolean; items: CrewOffRequest[] }>;
export function getCrewOffRequests(apiKey: string, status?: CrewOffStatus) {
  const qs = status !== undefined ? `?status=${status}` : '';
  return apiGet<{ ok: boolean; items: CrewOffRequest[] }>(`/crew-off-requests${qs}`, apiKey);
}

export function updateCrewOffStatus(apiKey: string, id: string, status: CrewOffStatus) {
  return apiPatch<{ ok: boolean; item: CrewOffRequest }>(
    `/crew-off-requests/${id}/status`,
    apiKey,
    { status },
  );
}

// ---- Export ----

export type ExportParams = { date: string } | { from: string; to: string };

export async function downloadExport(
  apiKey: string,
  format: 'csv' | 'xlsx',
  params: ExportParams,
): Promise<void> {
  const qs = new URLSearchParams();
  if ('date' in params) {
    qs.set('date', params.date);
  } else {
    qs.set('from', params.from);
    qs.set('to', params.to);
  }

  const res = await fetch(`${BASE_URL}/export/${format}?${qs.toString()}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status} ${res.statusText}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pinetree-export-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
