import crypto from 'node:crypto';
import type express from 'express';
import { z } from 'zod';

import type { BotAdapter, BotContext } from './types';
import { handleIncomingMessage } from './shared';

type SlackRawBodyRequest = express.Request & { rawBody?: Buffer };

type SlackPostMessageResponse = { ok: boolean; error?: string };

type SlackUsersInfoResponse =
  | {
      ok: true;
      user: {
        id: string;
        real_name?: string;
        name?: string;
        profile?: {
          display_name?: string;
          real_name?: string;
          image_192?: string;
          image_72?: string;
        };
      };
    }
  | { ok: false; error?: string };

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

async function slackSendMessage(params: {
  token: string;
  channel: string;
  text: string;
}): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify({ channel: params.channel, text: params.text }),
  });

  const json = (await res.json().catch(() => null)) as SlackPostMessageResponse | null;

  if (!res.ok || !json || json.ok !== true) {
    const err = json && json.ok === false ? json.error : `${res.status} ${res.statusText}`;
    throw new Error(`Slack chat.postMessage failed: ${err}`);
  }
}

async function slackGetUserProfile(params: {
  token: string;
  userId: string;
}): Promise<{ name: string; avatarUrl?: string } | null> {
  const url = new URL('https://slack.com/api/users.info');
  url.searchParams.set('user', params.userId);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.token}`,
    },
  });

  const json = (await res.json().catch(() => null)) as SlackUsersInfoResponse | null;
  if (!res.ok || !json || json.ok !== true) {
    return null;
  }

  const profile = json.user.profile;
  const name =
    profile?.display_name?.trim() ||
    profile?.real_name?.trim() ||
    json.user.real_name?.trim() ||
    json.user.name?.trim() ||
    json.user.id;

  const avatarUrl = profile?.image_192 ?? profile?.image_72;

  return avatarUrl ? { name, avatarUrl } : { name };
}

function buildSlackMenuText(): string {
  return [
    '- Start shift',
    '- Break start',
    '- Break end',
    '- End shift',
    '- Status update',
    '- menu',
  ].join('\n');
}

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

            const wantsFullMenu =
              p.showMenu === true && p.text.trim().toLowerCase() === 'choose an action:';

            const body = wantsFullMenu
              ? `${p.text}\n${buildSlackMenuText()}`
              : p.showMenu
                ? `${p.text}\n\nType "menu" to see options.`
                : p.text;
            await slackSendMessage({
              token: ctx.env.SLACK_BOT_TOKEN,
              channel: p.conversationId,
              text: body,
            });
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
    },
  };
}
