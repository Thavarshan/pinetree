import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createApp } from "../src/app";
import { getEnv } from "../src/env";
import { createPrismaClient } from "@pinetree/db";

const repoRoot = path.resolve(process.cwd(), "../..");

function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function runPrismaMigrateDeploy(databaseUrl: string): void {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "-C",
      "packages/db",
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      "prisma/schema.prisma",
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed with status ${result.status}`);
  }
}

describe("API integration", () => {
  const baseDatabaseUrl =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/pinetree?schema=public";
  const schemaName = `test_${process.pid}_${Date.now()}`;
  const databaseUrl = withSchema(baseDatabaseUrl, schemaName);

  const adminKey = "secret";
  const timezone = "UTC";

  let prisma: ReturnType<typeof createPrismaClient>;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.ADMIN_API_KEY = adminKey;
    process.env.TIMEZONE = timezone;
    process.env.PUBLIC_BASE_URL = "";
    process.env.VIBER_BOT_TOKEN = "";

    runPrismaMigrateDeploy(databaseUrl);

    prisma = createPrismaClient();
    app = createApp({ env: getEnv(), prisma });
  });

  afterAll(async () => {
    try {
      await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } catch {
      // best-effort cleanup
    }
    await prisma?.$disconnect();
  });

  it("rejects export without x-api-key", async () => {
    const res = await request(app).get("/export/csv").query({ date: "2026-01-01" });
    expect(res.status).toBe(401);
  });

  it("exports csv with x-api-key", async () => {
    const user = await prisma.user.create({
      data: { viberUserId: "u1", name: "Alice" },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { viberChatId: "c1" },
      select: { id: true },
    });

    await prisma.event.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        eventType: "SHIFT_START",
        sourceMessageId: "m1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const res = await request(app)
      .get("/export/csv")
      .set("x-api-key", adminKey)
      .query({ date: "2026-01-01" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("Date,User,Event type,Time (local)");
    expect(res.text).toContain("Alice");
    expect(res.text).toContain("SHIFT_START");
  });

  it("is idempotent for webhook retries (same message_token)", async () => {
    const payload = {
      event: "message",
      timestamp: Date.now(),
      message_token: "same-1",
      chat_id: "c2",
      sender: { id: "u2", name: "Bob" },
      message: { type: "text", text: "/start" },
    };

    const r1 = await request(app).post("/webhook/viber").send(payload);
    const r2 = await request(app).post("/webhook/viber").send(payload);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const events = await prisma.event.findMany({ where: { sourceMessageId: "same-1" } });
    expect(events).toHaveLength(1);
  });
});
