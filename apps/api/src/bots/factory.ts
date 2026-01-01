import type { BotAdapter, BotContext } from './types';
import { createSlackAdapter } from './slackAdapter';
import { createViberAdapter } from './viberAdapter';

export function getBotAdapters(ctx: BotContext): BotAdapter[] {
  // Factory: enable adapters based on available configuration.
  const adapters: BotAdapter[] = [];

  // Viber can receive webhooks even without a token (we just won't reply).
  adapters.push(createViberAdapter());

  // Slack requires signature verification.
  if (ctx.env.SLACK_SIGNING_SECRET) {
    adapters.push(createSlackAdapter());
  }

  return adapters;
}
