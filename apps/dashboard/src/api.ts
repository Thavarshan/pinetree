const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';

export const SESSION_KEY = 'pinetree_api_key';

function getApiKey(): string {
  return sessionStorage.getItem(SESSION_KEY) ?? '';
}

function apiHeaders(): Record<string, string> {
  return { 'x-api-key': getApiKey(), 'Content-Type': 'application/json' };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data: unknown = await res.json();
  return data as T;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: apiHeaders(),
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

export function getSupplyRequests(): Promise<{ ok: boolean; items: SupplyRequest[] }>;
export function getSupplyRequests(
  status: SupplyRequestStatus,
): Promise<{ ok: boolean; items: SupplyRequest[] }>;
export function getSupplyRequests(status?: SupplyRequestStatus) {
  const qs = status !== undefined ? `?status=${status}` : '';
  return apiGet<{ ok: boolean; items: SupplyRequest[] }>(`/supply-requests${qs}`);
}

export function updateSupplyRequestStatus(id: string, status: SupplyRequestStatus) {
  return apiPatch<{ ok: boolean; item: SupplyRequest }>(`/supply-requests/${id}/status`, {
    status,
  });
}

// ---- Concerns ----

export function getConcerns(): Promise<{ ok: boolean; items: Concern[] }>;
export function getConcerns(status: ConcernStatus): Promise<{ ok: boolean; items: Concern[] }>;
export function getConcerns(status?: ConcernStatus) {
  const qs = status !== undefined ? `?status=${status}` : '';
  return apiGet<{ ok: boolean; items: Concern[] }>(`/concerns${qs}`);
}

export function updateConcernStatus(id: string, status: ConcernStatus) {
  return apiPatch<{ ok: boolean; item: Concern }>(`/concerns/${id}/status`, { status });
}

// ---- Crew-Off Requests ----

export function getCrewOffRequests(): Promise<{ ok: boolean; items: CrewOffRequest[] }>;
export function getCrewOffRequests(
  status: CrewOffStatus,
): Promise<{ ok: boolean; items: CrewOffRequest[] }>;
export function getCrewOffRequests(status?: CrewOffStatus) {
  const qs = status !== undefined ? `?status=${status}` : '';
  return apiGet<{ ok: boolean; items: CrewOffRequest[] }>(`/crew-off-requests${qs}`);
}

export function updateCrewOffStatus(id: string, status: CrewOffStatus) {
  return apiPatch<{ ok: boolean; item: CrewOffRequest }>(`/crew-off-requests/${id}/status`, {
    status,
  });
}

// ---- Export ----

export type ExportParams = { date: string } | { from: string; to: string };

export async function downloadExport(format: 'csv' | 'xlsx', params: ExportParams): Promise<void> {
  const qs = new URLSearchParams();
  if ('date' in params) {
    qs.set('date', params.date);
  } else {
    qs.set('from', params.from);
    qs.set('to', params.to);
  }

  const res = await fetch(`${BASE_URL}/export/${format}?${qs.toString()}`, {
    headers: { 'x-api-key': getApiKey() },
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
