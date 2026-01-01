import express from "express";
import { z } from "zod";
import { DateTime } from "luxon";

import { parseEvent, EventType } from "@pinetree/core";
import type { PrismaClient } from "@pinetree/db";
import { Prisma } from "@pinetree/db";
import { eventsToCsv, eventsToXlsx, type ExportEvent } from "@pinetree/exporter";

import type { Env } from "./env";
import { buildMenuKeyboard, ViberWebhookSchema, viberSendMessage } from "./viber";
import { InMemoryPendingStatusStore, pendingKey } from "./pendingStatus";

type HttpError = Error & { status?: number };

export function createApp(params: { env: Env; prisma: PrismaClient }): express.Express {
  const { env, prisma } = params;

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const pendingStatus = new InMemoryPendingStatusStore();
  const seenUserChats = new Set<string>();

  async function maybeSendViber(
    receiver: string,
    text: string,
    keyboard?: ReturnType<typeof buildMenuKeyboard>,
  ): Promise<void> {
    if (!env.VIBER_BOT_TOKEN) return;

    if (keyboard) {
      await viberSendMessage({ token: env.VIBER_BOT_TOKEN, receiver, text, keyboard });
    } else {
      await viberSendMessage({ token: env.VIBER_BOT_TOKEN, receiver, text });
    }
  }

  function requireApiKey(req: express.Request): void {
    const key = req.header("x-api-key");
    if (!key || key !== env.ADMIN_API_KEY) {
      const err: HttpError = new Error("Unauthorized");
      err.status = 401;
      throw err;
    }
  }

  function parseDateRange(query: unknown, timezone: string): { from: Date; to: Date } {
    const schema = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .refine((q) => Boolean(q.date) || (Boolean(q.from) && Boolean(q.to)), {
        message: "Provide either date=YYYY-MM-DD or from=YYYY-MM-DD&to=YYYY-MM-DD",
      });

    const q = schema.parse(query);
    const fromStr = q.date ?? q.from!;
    const toStr = q.date ?? q.to!;

    const from = DateTime.fromISO(fromStr, { zone: timezone }).startOf("day");
    const to = DateTime.fromISO(toStr, { zone: timezone }).endOf("day");

    return { from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate() };
  }

  app.post("/webhook/viber", async (req, res, next) => {
    try {
      const parsed = ViberWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: "Invalid payload" });
      }

      const payload = parsed.data;

      if (payload.event !== "message") {
        return res.status(200).json({ ok: true });
      }

      const viberUserId = payload.sender?.id;
      const userName = payload.sender?.name ?? "Unknown";
      const avatarUrl = payload.sender?.avatar;
      const viberChatId = payload.chat_id;

      const messageText = payload.message?.text ?? "";
      const messageToken = payload.message_token;
      const sourceMessageId = messageToken != null ? String(messageToken) : undefined;

      if (!viberUserId || !sourceMessageId) {
        return res.status(400).json({ ok: false, error: "Missing sender or message id" });
      }

      const ts = typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
      const createdAt = new Date(ts);

      const key = pendingKey(viberChatId, viberUserId);
      const sawPending = pendingStatus.consumeIfPending(key);

      if (sawPending) {
        const { user, chat } = await upsertUserChat({
          prisma,
          viberUserId,
          userName,
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(viberChatId ? { viberChatId } : {}),
        });

        await insertEventIdempotent({
          prisma,
          chatId: chat.id,
          userId: user.id,
          eventType: EventType.STATUS,
          text: messageText,
          sourceMessageId,
          rawPayload: payload,
          createdAt,
        });

        await maybeSendViber(viberChatId ?? viberUserId, `Status saved: ${messageText}`, buildMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      const source = messageText.trim().startsWith("/")
        ? "command"
        : messageText.trim().toLowerCase() === "menu"
          ? "unknown"
          : "free_text";

      const result = parseEvent(messageText, { timezone: env.TIMEZONE, source });

      if (result.kind === "menu") {
        await maybeSendViber(viberChatId ?? viberUserId, "Choose an action:", buildMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      if (result.kind === "status_pending") {
        pendingStatus.setPending(key, 2 * 60 * 1000);
        await maybeSendViber(viberChatId ?? viberUserId, "Send your status text");
        return res.status(200).json({ ok: true });
      }

      if (result.kind !== "event") {
        const seenKey = `${viberChatId ?? "private"}::${viberUserId}`;
        if (!seenUserChats.has(seenKey)) {
          seenUserChats.add(seenKey);
          await maybeSendViber(viberChatId ?? viberUserId, "Choose an action:", buildMenuKeyboard());
        }
        return res.status(200).json({ ok: true });
      }

      const { user, chat } = await upsertUserChat({
        prisma,
        viberUserId,
        userName,
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(viberChatId ? { viberChatId } : {}),
      });

      await insertEventIdempotent({
        prisma,
        chatId: chat.id,
        userId: user.id,
        eventType: result.eventType,
        ...("text" in result && typeof result.text === "string" ? { text: result.text } : {}),
        sourceMessageId,
        rawPayload: payload,
        createdAt,
      });

      await maybeSendViber(
        viberChatId ?? viberUserId,
        `Recorded: ${result.eventType}`,
        buildMenuKeyboard(),
      );

      return res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/export/csv", async (req, res, next) => {
    try {
      requireApiKey(req);
      const range = parseDateRange(req.query, env.TIMEZONE);

      const events = await prisma.event.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });

      const rows: ExportEvent[] = events.map((e) => ({
        createdAt: e.createdAt,
        eventType: e.eventType as unknown as EventType,
        userName: e.user.name,
        text: e.text,
      }));

      const csv = eventsToCsv(rows, env.TIMEZONE);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=events.csv`);
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  });

  app.get("/export/xlsx", async (req, res, next) => {
    try {
      requireApiKey(req);
      const range = parseDateRange(req.query, env.TIMEZONE);

      const events = await prisma.event.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });

      const rows: ExportEvent[] = events.map((e) => ({
        createdAt: e.createdAt,
        eventType: e.eventType as unknown as EventType,
        userName: e.user.name,
        text: e.text,
      }));

      const xlsx = await eventsToXlsx(rows, env.TIMEZONE);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename=events.xlsx`);
      res.status(200).send(xlsx);
    } catch (err) {
      next(err);
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const statusCandidate =
        typeof err === "object" && err && "status" in err ? (err as { status?: unknown }).status : undefined;
      const status = typeof statusCandidate === "number" ? statusCandidate : 500;
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(status).json({ ok: false, error: message });
    },
  );

  return app;
}

async function upsertUserChat(params: {
  prisma: PrismaClient;
  viberUserId: string;
  userName: string;
  avatarUrl?: string;
  viberChatId?: string;
}): Promise<{ user: { id: string }; chat: { id: string } }> {
  const user = await params.prisma.user.upsert({
    where: { viberUserId: params.viberUserId },
    create: {
      viberUserId: params.viberUserId,
      name: params.userName,
      ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
    },
    update: {
      name: params.userName,
      ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : { avatarUrl: null }),
    },
    select: { id: true },
  });

  const viberChatId = params.viberChatId ?? `private:${params.viberUserId}`;
  const chat = await params.prisma.chat.upsert({
    where: { viberChatId },
    create: { viberChatId },
    update: {},
    select: { id: true },
  });

  return { user, chat };
}

async function insertEventIdempotent(params: {
  prisma: PrismaClient;
  chatId: string;
  userId: string;
  eventType: EventType;
  text?: string;
  sourceMessageId: string;
  rawPayload: unknown;
  createdAt: Date;
}): Promise<void> {
  try {
    await params.prisma.event.create({
      data: {
        chatId: params.chatId,
        userId: params.userId,
        eventType: params.eventType,
        ...(typeof params.text === "string" ? { text: params.text } : {}),
        sourceMessageId: params.sourceMessageId,
        rawPayload: JSON.stringify(params.rawPayload),
        createdAt: params.createdAt,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return;
    }
    throw e;
  }
}
