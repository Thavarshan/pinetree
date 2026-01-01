import express from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';

import type { EventType } from '@pinetree/core';
import type { PrismaClient } from '@pinetree/db';
import { eventsToCsv, eventsToXlsx, type ExportEvent } from '@pinetree/exporter';

import type { Env } from './env';
import { InMemoryPendingStatusStore } from './pendingStatus';
import { getBotAdapters } from './bots/factory';

type HttpError = Error & { status?: number };

export function createApp(params: { env: Env; prisma: PrismaClient }): express.Express {
  const { env, prisma } = params;

  const app = express();
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  const pendingStatus = new InMemoryPendingStatusStore();
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
