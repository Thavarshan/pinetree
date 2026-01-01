import type express from 'express';
import type { PrismaClient } from '@pinetree/db';

import type { Env } from '../env';
import type { InMemoryPendingStatusStore } from '../pendingStatus';

export type BotProvider = 'viber' | 'slack';

export type BotContext = {
  env: Env;
  prisma: PrismaClient;
  pendingStatus: InMemoryPendingStatusStore;
  seenUserChats: Set<string>;
};

export interface BotAdapter {
  provider: BotProvider;
  register(app: express.Express, ctx: BotContext): void;
}
