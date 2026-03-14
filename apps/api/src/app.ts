import cors from 'cors';
import express from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';

import type { EventType } from '@pinetree/core';
import type { PrismaClient } from '@pinetree/db';
import { eventsToCsv, eventsToXlsx, type ExportEvent } from '@pinetree/exporter';

import { getBotAdapters } from './bots/factory';
import type { Env } from './env';
import { PendingConversationStore } from './pendingStatus';
import { slackSendMessage } from './slack';

type HttpError = Error & { status?: number };

export function createApp(params: { env: Env; prisma: PrismaClient }): express.Express {
  const { env, prisma } = params;

  const app = express();
  app.use(
    cors({
      origin: env.DASHBOARD_URL || '*',
      methods: ['GET', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-api-key'],
    }),
  );
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  // Also parse URL-encoded bodies (needed for Slack interactive payloads).
  app.use(
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  const pendingStatus = new PendingConversationStore();
  const seenUserChats = new Set<string>();

  const botCtx = { env, prisma, pendingStatus, seenUserChats };
  for (const adapter of getBotAdapters(botCtx)) {
    adapter.register(app, botCtx);
  }

  function requireApiKey(req: express.Request): void {
    const key = req.header('x-api-key');
    if (!key || key !== env.ADMIN_API_KEY) {
      const err: HttpError = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
  }

  function parseDateRange(query: unknown, timezone: string): { from: Date; to: Date } {
    const schema = z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .refine((q) => Boolean(q.date) || (Boolean(q.from) && Boolean(q.to)), {
        message: 'Provide either date=YYYY-MM-DD or from=YYYY-MM-DD&to=YYYY-MM-DD',
      });

    const q = schema.parse(query);
    const fromStr = q.date ?? q.from!;
    const toStr = q.date ?? q.to!;

    const from = DateTime.fromISO(fromStr, { zone: timezone }).startOf('day');
    const to = DateTime.fromISO(toStr, { zone: timezone }).endOf('day');

    return { from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate() };
  }

  app.get('/export/csv', async (req, res, next) => {
    try {
      requireApiKey(req);
      const range = parseDateRange(req.query, env.TIMEZONE);

      const events = await prisma.event.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });

      const rows: ExportEvent[] = events.map((e) => ({
        createdAt: e.createdAt,
        eventType: e.eventType as unknown as EventType,
        userName: e.user.name,
        text: e.text,
      }));

      const csv = eventsToCsv(rows, env.TIMEZONE);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=events.csv`);
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  });

  app.get('/export/xlsx', async (req, res, next) => {
    try {
      requireApiKey(req);
      const range = parseDateRange(req.query, env.TIMEZONE);

      const events = await prisma.event.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });

      const rows: ExportEvent[] = events.map((e) => ({
        createdAt: e.createdAt,
        eventType: e.eventType as unknown as EventType,
        userName: e.user.name,
        text: e.text,
      }));

      const xlsx = await eventsToXlsx(rows, env.TIMEZONE);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename=events.xlsx`);
      res.status(200).send(xlsx);
    } catch (err) {
      next(err);
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ---- Workflow management endpoints (all require API key) ---------------------

  async function sendAck(provider: string, conversationId: string, text: string): Promise<void> {
    if (provider === 'slack' && env.SLACK_BOT_TOKEN) {
      await slackSendMessage({ token: env.SLACK_BOT_TOKEN, channel: conversationId, text }).catch(
        () => {},
      );
    }
  }

  // Supply requests
  app.get('/supply-requests', async (req, res, next) => {
    try {
      requireApiKey(req);
      const statusParsed = z
        .enum(['PENDING', 'IN_PROGRESS', 'DELIVERED'])
        .safeParse(req.query.status);
      const items = await prisma.supplyRequest.findMany({
        ...(statusParsed.success && { where: { status: statusParsed.data } }),
        include: { user: { select: { name: true } }, chat: { select: { providerChatId: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ ok: true, items });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/supply-requests/:id/status', async (req, res, next) => {
    try {
      requireApiKey(req);
      const { id } = req.params;
      const { status } = z
        .object({ status: z.enum(['PENDING', 'IN_PROGRESS', 'DELIVERED']) })
        .parse(req.body);
      const item = await prisma.supplyRequest.update({
        where: { id },
        data: { status },
        include: { chat: { select: { provider: true, providerChatId: true } } },
      });

      const ackText =
        status === 'IN_PROGRESS'
          ? '🔄 Your supply request is being processed.'
          : status === 'DELIVERED'
            ? '✅ Your supply request has been delivered.'
            : null;
      if (ackText) {
        await sendAck(item.chat.provider, item.chat.providerChatId, ackText);
      }

      res.json({ ok: true, item });
    } catch (err) {
      next(err);
    }
  });

  // Concerns
  app.get('/concerns', async (req, res, next) => {
    try {
      requireApiKey(req);
      const statusParsed = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED']).safeParse(req.query.status);
      const items = await prisma.concern.findMany({
        ...(statusParsed.success && { where: { status: statusParsed.data } }),
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ ok: true, items });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/concerns/:id/status', async (req, res, next) => {
    try {
      requireApiKey(req);
      const { id } = req.params;
      const { status } = z
        .object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED']) })
        .parse(req.body);
      const item = await prisma.concern.update({ where: { id }, data: { status } });

      // Req 9: send acknowledgement back to the cleaner when their concern is resolved.
      if (status === 'COMPLETED') {
        const ackMessages: Record<string, string> = {
          COMPLETED: '✅ Your concern has been noted and resolved. Thank you for reporting it.',
        };
        await sendAck(
          item.provider,
          item.conversationId,
          ackMessages[status] ?? '✅ Update received.',
        );
      } else if (status === 'IN_PROGRESS') {
        await sendAck(
          item.provider,
          item.conversationId,
          '🔄 Your concern is being reviewed by our team.',
        );
      }

      res.json({ ok: true, item });
    } catch (err) {
      next(err);
    }
  });

  // Crew-off requests
  app.get('/crew-off-requests', async (req, res, next) => {
    try {
      requireApiKey(req);
      const statusParsed = z.enum(['PENDING', 'APPROVED', 'DENIED']).safeParse(req.query.status);
      const items = await prisma.crewOffRequest.findMany({
        ...(statusParsed.success && { where: { status: statusParsed.data } }),
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ ok: true, items });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/crew-off-requests/:id/status', async (req, res, next) => {
    try {
      requireApiKey(req);
      const { id } = req.params;
      const { status } = z
        .object({ status: z.enum(['PENDING', 'APPROVED', 'DENIED']) })
        .parse(req.body);
      const item = await prisma.crewOffRequest.update({
        where: { id },
        data: { status },
        include: { chat: { select: { provider: true, providerChatId: true } } },
      });

      const ackText =
        status === 'APPROVED'
          ? '✅ Your crew-off request has been approved.'
          : status === 'DENIED'
            ? '❌ Your crew-off request has been denied.'
            : null;
      if (ackText) {
        await sendAck(item.chat.provider, item.chat.providerChatId, ackText);
      }

      res.json({ ok: true, item });
    } catch (err) {
      next(err);
    }
  });

  app.use(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const statusCandidate =
        typeof err === 'object' && err && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;
      const status = typeof statusCandidate === 'number' ? statusCandidate : 500;
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(status).json({ ok: false, error: message });
    },
  );

  return app;
}
