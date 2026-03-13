import type express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';

import { slackGetUserProfile, slackSendMessage } from '../slack';
import { handleIncomingMessage } from './shared';
import type { BotAdapter, BotContext } from './types';

type SlackRawBodyRequest = express.Request & { rawBody?: Buffer };

const SlackEventPayloadSchema = z
  .object({
    type: z.string(),
    team_id: z.string().optional(),
    api_app_id: z.string().optional(),
    challenge: z.string().optional(),
    event_id: z.string().optional(),
    event_time: z.number().optional(),
    event: z
      .object({
        type: z.string(),
        subtype: z.string().optional(),
        user: z.string().optional(),
        bot_id: z.string().optional(),
        text: z.string().optional(),
        channel: z.string().optional(),
        ts: z.string().optional(),
        files: z
          .array(
            z
              .object({
                url_private_download: z.string().optional(),
                mimetype: z.string().optional(),
                name: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifySlackSignature(params: {
  signingSecret: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: Buffer | undefined;
}): boolean {
  const { signingSecret, timestampHeader, signatureHeader, rawBody } = params;
  if (!signingSecret) return false;
  if (!timestampHeader || !signatureHeader || !rawBody) return false;

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  // Reject replays older than 5 minutes.
  if (Math.abs(nowSec - ts) > 60 * 5) return false;

  const base = `v0:${timestampHeader}:${rawBody.toString('utf8')}`;
  const digest = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  const expected = `v0=${digest}`;

  return timingSafeEqualHex(expected, signatureHeader);
}

// Maps Slack Block Kit action_id values to the bot message text they represent.
const actionIdToText: Record<string, string> = {
  shift_start: '🟢 Start shift',
  break_start: '☕ Break start',
  break_end: '✅ Break end',
  shift_end: '🔴 End shift',
  status_update: '📝 Status update',
  supply_request: '🛒 Supply request',
  concern: '⚠️ Report concern',
  crew_off: '🏖️ Crew off',
};

function buildSlackMenuBlocks(): object[] {
  const buttons: Array<{ label: string; actionId: string; style?: 'primary' | 'danger' }> = [
    { label: '🟢 Sign In', actionId: 'shift_start', style: 'primary' },
    { label: '☕ Break Start', actionId: 'break_start' },
    { label: '✅ Break End', actionId: 'break_end' },
    { label: '🔴 Sign Off', actionId: 'shift_end', style: 'danger' },
    { label: '📝 Status Update', actionId: 'status_update' },
    { label: '🛒 Supply Request', actionId: 'supply_request' },
    { label: '⚠️ Report Concern', actionId: 'concern' },
    { label: '🏖️ Crew Off', actionId: 'crew_off' },
  ];
  return [
    {
      type: 'actions',
      elements: buttons.map((b) => ({
        type: 'button',
        text: { type: 'plain_text', text: b.label, emoji: true },
        action_id: b.actionId,
        ...(b.style ? { style: b.style } : {}),
      })),
    },
  ];
}

const SlackActionPayloadSchema = z
  .object({
    type: z.string(),
    user: z.object({ id: z.string() }).passthrough(),
    channel: z.object({ id: z.string() }).passthrough().optional(),
    actions: z.array(z.object({ action_id: z.string(), type: z.string() }).passthrough()),
    message: z.object({ ts: z.string() }).passthrough().optional(),
  })
  .passthrough();

export function createSlackAdapter(): BotAdapter {
  return {
    provider: 'slack',
    register(app: express.Express, ctx: BotContext) {
      const userCache = new Map<
        string,
        { value: { name: string; avatarUrl?: string } | null; expiresAt: number }
      >();
      const userCacheTtlMs = 60 * 60 * 1000;

      app.post('/webhook/slack', (req, res, next) => {
        const rawReq = req as SlackRawBodyRequest;

        try {
          if (!ctx.env.SLACK_SIGNING_SECRET) {
            return res.status(501).json({ ok: false, error: 'Slack not configured' });
          }

          const ok = verifySlackSignature({
            signingSecret: ctx.env.SLACK_SIGNING_SECRET,
            timestampHeader: req.header('x-slack-request-timestamp') ?? undefined,
            signatureHeader: req.header('x-slack-signature') ?? undefined,
            rawBody: rawReq.rawBody,
          });

          if (!ok) {
            return res.status(401).json({ ok: false, error: 'Invalid Slack signature' });
          }

          const parsed = SlackEventPayloadSchema.safeParse(req.body);
          if (!parsed.success) {
            return res.status(400).json({ ok: false, error: 'Invalid payload' });
          }

          const payload = parsed.data;

          if (payload.type === 'url_verification' && payload.challenge) {
            return res.status(200).json({ challenge: payload.challenge });
          }

          // Always ack quickly to avoid Slack retries.
          res.status(200).json({ ok: true });

          if (payload.type !== 'event_callback') return;
          if (!payload.event) return;

          const event = payload.event;

          if (event.type !== 'message') return;
          if (event.bot_id) return; // ignore bot-authored messages (prevents reply loops)
          if (event.subtype) return; // ignore bot_message, message_changed, etc.

          const slackUserId = event.user;
          const channel = event.channel;
          const text = event.text ?? '';
          const eventId = payload.event_id ?? event.ts;

          if (!slackUserId || !channel || !eventId) return;

          const createdAt = payload.event_time ? new Date(payload.event_time * 1000) : new Date();

          const sendMessage = async (p: {
            conversationId: string;
            text: string;
            showMenu?: boolean;
          }) => {
            if (!ctx.env.SLACK_BOT_TOKEN) return;
            if (p.showMenu) {
              await slackSendMessage({
                token: ctx.env.SLACK_BOT_TOKEN,
                channel: p.conversationId,
                text: p.text,
                blocks: buildSlackMenuBlocks(),
              });
            } else {
              await slackSendMessage({
                token: ctx.env.SLACK_BOT_TOKEN,
                channel: p.conversationId,
                text: p.text,
              });
            }
          };

          const getUserInfo = async (): Promise<{ name: string; avatarUrl?: string } | null> => {
            if (!ctx.env.SLACK_BOT_TOKEN) return null;
            const now = Date.now();
            const cached = userCache.get(slackUserId);
            if (cached && cached.expiresAt > now) return cached.value;

            const value = await slackGetUserProfile({
              token: ctx.env.SLACK_BOT_TOKEN,
              userId: slackUserId,
            });
            userCache.set(slackUserId, { value, expiresAt: now + userCacheTtlMs });
            return value;
          };

          void (async () => {
            const userInfo = await getUserInfo().catch(() => null);
            const firstFile = event.files?.[0];
            await handleIncomingMessage({
              provider: 'slack',
              env: ctx.env,
              prisma: ctx.prisma,
              pendingStatus: ctx.pendingStatus,
              seenUserChats: ctx.seenUserChats,
              providerUserId: slackUserId,
              userName: userInfo?.name ?? slackUserId,
              ...(userInfo?.avatarUrl ? { avatarUrl: userInfo.avatarUrl } : {}),
              providerChatId: channel,
              conversationId: channel,
              messageText: text,
              sourceMessageId: eventId,
              rawPayload: payload,
              createdAt,
              ...(firstFile?.url_private_download
                ? { mediaUrl: firstFile.url_private_download }
                : {}),
              ...(firstFile?.mimetype ? { mediaType: firstFile.mimetype } : {}),
              sendMessage,
            });
          })().catch((e) => {
            // best-effort logging; request is already acked
            console.error(e);
          });
        } catch (err) {
          next(err);
        }
      });

      // Slack interactive components (Block Kit button clicks).
      app.post('/webhook/slack/actions', (req, res, next) => {
        const rawReq = req as SlackRawBodyRequest;
        try {
          if (!ctx.env.SLACK_SIGNING_SECRET) {
            return res.status(501).json({ ok: false, error: 'Slack not configured' });
          }

          const ok = verifySlackSignature({
            signingSecret: ctx.env.SLACK_SIGNING_SECRET,
            timestampHeader: req.header('x-slack-request-timestamp') ?? undefined,
            signatureHeader: req.header('x-slack-signature') ?? undefined,
            rawBody: rawReq.rawBody,
          });
          if (!ok) {
            return res.status(401).json({ ok: false, error: 'Invalid Slack signature' });
          }

          // Slack sends interactive payloads as URL-encoded `payload` field.
          const rawPayloadStr =
            typeof req.body === 'string'
              ? req.body
              : (req.body as Record<string, unknown>)?.payload;

          if (typeof rawPayloadStr !== 'string') {
            return res.status(400).json({ ok: false, error: 'Missing payload' });
          }

          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(rawPayloadStr);
          } catch {
            return res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
          }

          const parsed = SlackActionPayloadSchema.safeParse(parsedJson);
          if (!parsed.success) {
            return res.status(400).json({ ok: false, error: 'Invalid action payload' });
          }

          // Ack immediately.
          res.status(200).send('');

          const actionPayload = parsed.data;
          if (actionPayload.type !== 'block_actions') return;

          const slackUserId = actionPayload.user.id;
          const channelId = actionPayload.channel?.id;
          const firstAction = actionPayload.actions[0];
          if (!channelId || !firstAction) return;

          const messageText = actionIdToText[firstAction.action_id];
          if (!messageText) return;

          // Use message ts as idempotency key.
          const actionSourceId = `action:${firstAction.action_id}:${actionPayload.message?.ts ?? Date.now()}`;

          const sendMessage = async (p: {
            conversationId: string;
            text: string;
            showMenu?: boolean;
          }) => {
            if (!ctx.env.SLACK_BOT_TOKEN) return;
            if (p.showMenu) {
              await slackSendMessage({
                token: ctx.env.SLACK_BOT_TOKEN,
                channel: p.conversationId,
                text: p.text,
                blocks: buildSlackMenuBlocks(),
              });
            } else {
              await slackSendMessage({
                token: ctx.env.SLACK_BOT_TOKEN,
                channel: p.conversationId,
                text: p.text,
              });
            }
          };

          void (async () => {
            const userInfo = await (ctx.env.SLACK_BOT_TOKEN
              ? slackGetUserProfile({ token: ctx.env.SLACK_BOT_TOKEN, userId: slackUserId }).catch(
                  () => null,
                )
              : Promise.resolve(null));

            await handleIncomingMessage({
              provider: 'slack',
              env: ctx.env,
              prisma: ctx.prisma,
              pendingStatus: ctx.pendingStatus,
              seenUserChats: ctx.seenUserChats,
              providerUserId: slackUserId,
              userName: userInfo?.name ?? slackUserId,
              ...(userInfo?.avatarUrl ? { avatarUrl: userInfo.avatarUrl } : {}),
              providerChatId: channelId,
              conversationId: channelId,
              messageText,
              sourceMessageId: actionSourceId,
              rawPayload: actionPayload,
              createdAt: new Date(),
              sendMessage,
            });
          })().catch((e) => console.error('[slack actions]', e));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
