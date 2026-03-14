import { createSlackAdapter } from './slackAdapter';
import type { BotAdapter, BotContext } from './types';

export function getBotAdapters(ctx: BotContext): BotAdapter[] {
  const adapters: BotAdapter[] = [];

  if (ctx.env.SLACK_SIGNING_SECRET) {
    adapters.push(createSlackAdapter());
  }

  return adapters;
}
