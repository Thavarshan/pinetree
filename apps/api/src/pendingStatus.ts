type PendingKey = string;

export type PendingState =
  | { type: 'status' }
  | { type: 'supply_request' }
  | { type: 'concern' }
  | { type: 'crew_off' };

type PendingEntry = {
  state: PendingState;
  expiresAt: number;
};

export class PendingConversationStore {
  private readonly pending = new Map<PendingKey, PendingEntry>();

  setPending(key: PendingKey, state: PendingState, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.pending.set(key, { state, expiresAt });
  }

  consumeIfPending(key: PendingKey): PendingState | null {
    const entry = this.pending.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.pending.delete(key);
      return null;
    }
    this.pending.delete(key);
    return entry.state;
  }
}

export function pendingKey(providerChatId: string | undefined, providerUserId: string): string {
  // In a community/group context, tie pending state to chat+user.
  return `${providerChatId ?? 'private'}::${providerUserId}`;
}
