import type express from 'express';

import { buildMenuKeyboard, ViberWebhookSchema, viberSendMessage } from '../viber';
import type { BotAdapter, BotContext } from './types';
import { handleIncomingMessage } from './shared';

export function createViberAdapter(): BotAdapter {
  return {
    provider: 'viber',
    register(app: express.Express, ctx: BotContext) {
      app.post('/webhook/viber', async (req, res, next) => {
        try {
          const parsed = ViberWebhookSchema.safeParse(req.body);
          if (!parsed.success) {
            return res.status(400).json({ ok: false, error: 'Invalid payload' });
          }

          const payload = parsed.data;

          if (payload.event !== 'message') {
            return res.status(200).json({ ok: true });
          }

          const viberUserId = payload.sender?.id;
          const userName = payload.sender?.name ?? 'Unknown';
          const avatarUrl = payload.sender?.avatar;
          const viberChatId = payload.chat_id;

          const messageText = payload.message?.text ?? '';
          const messageToken = payload.message_token;
          const sourceMessageId = messageToken != null ? String(messageToken) : undefined;

          if (!viberUserId || !sourceMessageId) {
            return res.status(400).json({ ok: false, error: 'Missing sender or message id' });
          }

          const ts = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
          const createdAt = new Date(ts);

          const conversationId = viberChatId ?? viberUserId;

          const sendMessage = async (p: {
            conversationId: string;
            text: string;
            showMenu?: boolean;
          }) => {
            if (!ctx.env.VIBER_BOT_TOKEN) return;
            if (p.showMenu) {
              await viberSendMessage({
                token: ctx.env.VIBER_BOT_TOKEN,
                receiver: p.conversationId,
                text: p.text,
                keyboard: buildMenuKeyboard(),
              });
              return;
            }
            await viberSendMessage({
              token: ctx.env.VIBER_BOT_TOKEN,
              receiver: p.conversationId,
              text: p.text,
            });
          };

          await handleIncomingMessage({
            provider: 'viber',
            env: ctx.env,
            prisma: ctx.prisma,
            pendingStatus: ctx.pendingStatus,
            seenUserChats: ctx.seenUserChats,
            providerUserId: viberUserId,
            userName,
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(viberChatId ? { providerChatId: viberChatId } : {}),
            conversationId,
            messageText,
            sourceMessageId,
            rawPayload: payload,
            createdAt,
            sendMessage,
          });

          return res.status(200).json({ ok: true });
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
