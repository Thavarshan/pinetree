import type { PrismaClient } from '@pinetree/db';
import type express from 'express';

import type { Env } from '../env';
import type { PendingConversationStore } from '../pendingStatus';

export type BotProvider = 'slack';

export type BotContext = {
  env: Env;
  prisma: PrismaClient;
  pendingStatus: PendingConversationStore;
  seenUserChats: Set<string>;
};

export interface BotAdapter {
  provider: BotProvider;
  register(app: express.Express, ctx: BotContext): void;
}
