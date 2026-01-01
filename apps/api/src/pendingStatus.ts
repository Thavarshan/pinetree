type PendingKey = string;

type PendingStatus = {
  expiresAt: number;
};

export class InMemoryPendingStatusStore {
  private readonly pending = new Map<PendingKey, PendingStatus>();

  setPending(key: PendingKey, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.pending.set(key, { expiresAt });
  }

  consumeIfPending(key: PendingKey): boolean {
    const entry = this.pending.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.pending.delete(key);
      return false;
    }
    this.pending.delete(key);
    return true;
  }
}

export function pendingKey(viberChatId: string | undefined, viberUserId: string): string {
  // In a community/group context, tie pending state to chat+user.
  return `${viberChatId ?? "private"}::${viberUserId}`;
}
