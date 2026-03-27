import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPrismaClient } from '@pinetree/db';
import { createApp } from '../src/app';
import { getEnv } from '../src/env';

// Prevent real outbound Slack HTTP calls during tests.
vi.mock('../src/slack', () => ({
  slackSendMessage: vi.fn().mockResolvedValue(undefined),
  slackGetUserProfile: vi.fn().mockResolvedValue(null),
  slackUpdateMessage: vi.fn().mockResolvedValue(undefined),
  notifySlackChannel: vi.fn().mockResolvedValue(undefined),
}));

const repoRoot = path.resolve(process.cwd(), '../..');
const TEST_SIGNING_SECRET = 'test-signing-secret';

/** Compute Slack request signature headers for a JSON body. */
function slackSign(body: object): {
  'x-slack-request-timestamp': string;
  'x-slack-signature': string;
} {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const raw = JSON.stringify(body);
  const sig = crypto
    .createHmac('sha256', TEST_SIGNING_SECRET)
    .update(`v0:${timestamp}:${raw}`)
    .digest('hex');
  return { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${sig}` };
}

function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

function runPrismaMigrateDeploy(databaseUrl: string): void {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy'],
    {
      cwd: path.join(repoRoot, 'packages', 'db'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );

  if (result.status !== 0) {
    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(
      `prisma migrate deploy failed (status ${result.status})\n${stdout}\n${stderr}`.trim(),
    );
  }
}

describe('API integration', () => {
  const baseDatabaseUrl =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/pinetree?schema=public';
  const schemaName = `test_${process.pid}_${Date.now()}`;
  const databaseUrl = withSchema(baseDatabaseUrl, schemaName);

  const adminKey = 'secret';
  const timezone = 'UTC';

  let prisma: ReturnType<typeof createPrismaClient>;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.ADMIN_API_KEY = adminKey;
    process.env.TIMEZONE = timezone;
    process.env.PUBLIC_BASE_URL = '';
    process.env.SLACK_BOT_TOKEN = '';
    process.env.SLACK_SIGNING_SECRET = TEST_SIGNING_SECRET;

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

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Export auth + CSV output
  // ---------------------------------------------------------------------------

  it('rejects export without x-api-key', async () => {
    const res = await request(app).get('/export/csv').query({ date: '2026-01-01' });
    expect(res.status).toBe(401);
  });

  it('exports csv with x-api-key', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'u1', name: 'Alice' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'c1' },
      select: { id: true },
    });

    await prisma.event.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        eventType: 'SHIFT_START',
        sourceMessageId: 'm1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const res = await request(app)
      .get('/export/csv')
      .set('x-api-key', adminKey)
      .query({ date: '2026-01-01' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Date,User,Event type,Time (local)');
    expect(res.text).toContain('Alice');
    expect(res.text).toContain('SHIFT_START');
  });

  it('exports xlsx with x-api-key', async () => {
    const res = await request(app)
      .get('/export/xlsx')
      .set('x-api-key', adminKey)
      .query({ date: '2026-01-01' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  // ---------------------------------------------------------------------------
  // Supply requests — REST endpoints
  // ---------------------------------------------------------------------------

  it('GET /supply-requests requires auth', async () => {
    const res = await request(app).get('/supply-requests');
    expect(res.status).toBe(401);
  });

  it('GET /supply-requests returns list', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'sr-u1', name: 'Hank' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'sr-c1' },
      select: { id: true },
    });
    await prisma.supplyRequest.create({
      data: { userId: user.id, chatId: chat.id, status: 'PENDING' },
    });

    const res = await request(app).get('/supply-requests').set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    const supplyListBody = res.body as { ok: boolean; items: { status: string }[] };
    expect(supplyListBody.ok).toBe(true);
    expect(Array.isArray(supplyListBody.items)).toBe(true);
    expect(supplyListBody.items.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /supply-requests filters by status', async () => {
    const res = await request(app)
      .get('/supply-requests')
      .set('x-api-key', adminKey)
      .query({ status: 'DELIVERED' });
    expect(res.status).toBe(200);
    const items = (res.body as { items: { status: string }[] }).items;
    expect(items.every((i) => i.status === 'DELIVERED')).toBe(true);
  });

  it('PATCH /supply-requests/:id/status updates status', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'sr-u2', name: 'Iris' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'sr-c2' },
      select: { id: true },
    });
    const sr = await prisma.supplyRequest.create({
      data: { userId: user.id, chatId: chat.id, status: 'PENDING' },
    });

    const res = await request(app)
      .patch(`/supply-requests/${sr.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect((res.body as { item: { status: string } }).item.status).toBe('IN_PROGRESS');
  });

  it('PATCH /supply-requests/:id/status rejects invalid status', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'sr-u3', name: 'Jack' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'sr-c3' },
      select: { id: true },
    });
    const sr = await prisma.supplyRequest.create({
      data: { userId: user.id, chatId: chat.id, status: 'PENDING' },
    });

    const res = await request(app)
      .patch(`/supply-requests/${sr.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'INVALID' });

    expect(res.status).toBe(500);
  });

  // ---------------------------------------------------------------------------
  // Concerns — REST endpoints
  // ---------------------------------------------------------------------------

  it('GET /concerns requires auth', async () => {
    const res = await request(app).get('/concerns');
    expect(res.status).toBe(401);
  });

  it('GET /concerns returns list', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'con-u1', name: 'Kate' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'con-c1' },
      select: { id: true },
    });
    await prisma.concern.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        text: 'Toilet blocked',
        conversationId: 'con-c1',
        provider: 'slack',
        status: 'OPEN',
      },
    });

    const res = await request(app).get('/concerns').set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    const concernListBody = res.body as { ok: boolean; items: { text: string }[] };
    expect(concernListBody.ok).toBe(true);
    const items = concernListBody.items;
    expect(items.some((i) => i.text === 'Toilet blocked')).toBe(true);
  });

  it('PATCH /concerns/:id/status updates to IN_PROGRESS', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'con-u2', name: 'Leo' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'con-c2' },
      select: { id: true },
    });
    const concern = await prisma.concern.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        text: 'Light broken',
        conversationId: 'con-c2',
        provider: 'slack',
        status: 'OPEN',
      },
    });

    const res = await request(app)
      .patch(`/concerns/${concern.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect((res.body as { item: { status: string } }).item.status).toBe('IN_PROGRESS');
  });

  it('PATCH /concerns/:id/status updates to COMPLETED', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'con-u3', name: 'Mia' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'con-c3' },
      select: { id: true },
    });
    const concern = await prisma.concern.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        text: 'Floor wet',
        conversationId: 'con-c3',
        provider: 'slack',
        status: 'OPEN',
      },
    });

    const res = await request(app)
      .patch(`/concerns/${concern.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(200);
    expect((res.body as { item: { status: string } }).item.status).toBe('COMPLETED');
  });

  // ---------------------------------------------------------------------------
  // Crew-off requests — REST endpoints
  // ---------------------------------------------------------------------------

  it('GET /crew-off-requests requires auth', async () => {
    const res = await request(app).get('/crew-off-requests');
    expect(res.status).toBe(401);
  });

  it('GET /crew-off-requests returns list', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'cr-u1', name: 'Ned' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'cr-c1' },
      select: { id: true },
    });
    await prisma.crewOffRequest.create({
      data: { userId: user.id, chatId: chat.id, text: 'Holiday', status: 'PENDING' },
    });

    const res = await request(app).get('/crew-off-requests').set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    const crewOffListBody = res.body as { ok: boolean; items: { text: string }[] };
    expect(crewOffListBody.ok).toBe(true);
    const items = crewOffListBody.items;
    expect(items.some((i) => i.text === 'Holiday')).toBe(true);
  });

  it('PATCH /crew-off-requests/:id/status approves a request', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'cr-u2', name: 'Olivia' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'cr-c2' },
      select: { id: true },
    });
    const cr = await prisma.crewOffRequest.create({
      data: { userId: user.id, chatId: chat.id, text: 'School event', status: 'PENDING' },
    });

    const res = await request(app)
      .patch(`/crew-off-requests/${cr.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'APPROVED' });

    expect(res.status).toBe(200);
    expect((res.body as { item: { status: string } }).item.status).toBe('APPROVED');
  });

  it('PATCH /crew-off-requests/:id/status denies a request', async () => {
    const user = await prisma.user.create({
      data: { provider: 'slack', providerUserId: 'cr-u3', name: 'Paul' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'slack', providerChatId: 'cr-c3' },
      select: { id: true },
    });
    const cr = await prisma.crewOffRequest.create({
      data: { userId: user.id, chatId: chat.id, text: 'Personal day', status: 'PENDING' },
    });

    const res = await request(app)
      .patch(`/crew-off-requests/${cr.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'DENIED' });

    expect(res.status).toBe(200);
    expect((res.body as { item: { status: string } }).item.status).toBe('DENIED');
  });

  // ---------------------------------------------------------------------------
  // Slack webhook — bot reply loop prevention
  // ---------------------------------------------------------------------------

  it('ignores Slack messages with app_id set (bot loop prevention)', async () => {
    const before = await prisma.event.count();

    const body = {
      type: 'event_callback',
      event_id: 'Ev_bot_app_id',
      event_time: Math.floor(Date.now() / 1000),
      event: {
        type: 'message',
        user: 'U_BOT',
        app_id: 'A_PINETREE',
        text: '✅ Shift started.',
        channel: 'C_TEST',
        ts: '100.001',
      },
    };
    const res = await request(app).post('/webhook/slack').set(slackSign(body)).send(body);

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  it('ignores Slack messages with bot_id set', async () => {
    const before = await prisma.event.count();

    const body = {
      type: 'event_callback',
      event_id: 'Ev_bot_id',
      event_time: Math.floor(Date.now() / 1000),
      event: {
        type: 'message',
        bot_id: 'B_PINETREE',
        text: '✅ Shift started.',
        channel: 'C_TEST',
        ts: '100.002',
      },
    };
    const res = await request(app).post('/webhook/slack').set(slackSign(body)).send(body);

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  it('ignores Slack messages with no user field', async () => {
    const before = await prisma.event.count();

    const body = {
      type: 'event_callback',
      event_id: 'Ev_no_user',
      event_time: Math.floor(Date.now() / 1000),
      event: {
        type: 'message',
        text: 'some automated message',
        channel: 'C_TEST',
        ts: '100.003',
      },
    };
    const res = await request(app).post('/webhook/slack').set(slackSign(body)).send(body);

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  it('ignores Slack messages with bot_message subtype', async () => {
    const before = await prisma.event.count();

    const body = {
      type: 'event_callback',
      event_id: 'Ev_subtype',
      event_time: Math.floor(Date.now() / 1000),
      event: {
        type: 'message',
        subtype: 'bot_message',
        user: 'U_BOT',
        text: '✅ Shift started.',
        channel: 'C_TEST',
        ts: '100.004',
      },
    };
    const res = await request(app).post('/webhook/slack').set(slackSign(body)).send(body);

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  // ---------------------------------------------------------------------------
  // Slack webhook — url_verification challenge
  // ---------------------------------------------------------------------------

  it('responds to Slack url_verification challenge', async () => {
    const body = { type: 'url_verification', challenge: 'abc123' };
    const res = await request(app).post('/webhook/slack').set(slackSign(body)).send(body);

    expect(res.status).toBe(200);
    expect((res.body as { challenge: string }).challenge).toBe('abc123');
  });
});
