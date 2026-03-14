import { spawnSync } from 'node:child_process';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPrismaClient } from '@pinetree/db';
import { createApp } from '../src/app';
import { getEnv } from '../src/env';

// Prevent real outbound Slack / Viber HTTP calls during tests.
vi.mock('../src/slack', () => ({
  slackSendMessage: vi.fn().mockResolvedValue(undefined),
  slackGetUserProfile: vi.fn().mockResolvedValue(null),
  notifySlackChannel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/viber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/viber')>();
  return { ...actual, viberSendMessage: vi.fn().mockResolvedValue(undefined) };
});

const repoRoot = path.resolve(process.cwd(), '../..');

function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

function runPrismaMigrateDeploy(databaseUrl: string): void {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    [
      '-C',
      'packages/db',
      'exec',
      'prisma',
      'migrate',
      'deploy',
      '--schema',
      'prisma/schema.prisma',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed with status ${result.status}`);
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
    process.env.VIBER_BOT_TOKEN = '';
    process.env.SLACK_BOT_TOKEN = '';
    process.env.SLACK_SIGNING_SECRET = '';

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
      data: { provider: 'viber', providerUserId: 'u1', name: 'Alice' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'viber', providerChatId: 'c1' },
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
  // Viber webhook — idempotency
  // ---------------------------------------------------------------------------

  it('is idempotent for webhook retries (same message_token)', async () => {
    const payload = {
      event: 'message',
      timestamp: Date.now(),
      message_token: 'same-1',
      chat_id: 'c2',
      sender: { id: 'u2', name: 'Bob' },
      message: { type: 'text', text: '/start' },
    };

    const r1 = await request(app).post('/webhook/viber').send(payload);
    const r2 = await request(app).post('/webhook/viber').send(payload);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const events = await prisma.event.findMany({ where: { sourceMessageId: 'viber:same-1' } });
    expect(events).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Viber webhook — basic single-step events
  // ---------------------------------------------------------------------------

  it('records SHIFT_END via Viber /end command', async () => {
    const res = await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: Date.now(),
        message_token: 'end-1',
        chat_id: 'c-end',
        sender: { id: 'u-end', name: 'Charlie' },
        message: { type: 'text', text: '/end' },
      });
    expect(res.status).toBe(200);

    const ev = await prisma.event.findUnique({ where: { sourceMessageId: 'viber:end-1' } });
    expect(ev?.eventType).toBe('SHIFT_END');
  });

  it('records BREAK_START via Viber button text', async () => {
    const res = await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: Date.now(),
        message_token: 'break-1',
        chat_id: 'c-break',
        sender: { id: 'u-break', name: 'Dana' },
        message: { type: 'text', text: '☕ Break start' },
      });
    expect(res.status).toBe(200);

    const ev = await prisma.event.findUnique({ where: { sourceMessageId: 'viber:break-1' } });
    expect(ev?.eventType).toBe('BREAK_START');
  });

  it('ignores non-message Viber events', async () => {
    const res = await request(app)
      .post('/webhook/viber')
      .send({ event: 'delivered', timestamp: Date.now(), message_token: 'del-1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Viber webhook — two-step status update flow
  // ---------------------------------------------------------------------------

  it('records a STATUS event via two-step Viber flow', async () => {
    const ts = Date.now();

    await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: ts,
        message_token: `status-step1-${ts}`,
        chat_id: 'c-status',
        sender: { id: 'u-status', name: 'Eve' },
        message: { type: 'text', text: '📝 Status update' },
      });

    const r2 = await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: ts + 1000,
        message_token: `status-step2-${ts}`,
        chat_id: 'c-status',
        sender: { id: 'u-status', name: 'Eve' },
        message: { type: 'text', text: 'Cleaning west wing' },
      });
    expect(r2.status).toBe(200);

    const ev = await prisma.event.findUnique({
      where: { sourceMessageId: `viber:status-step2-${ts}` },
    });
    expect(ev?.eventType).toBe('STATUS');
    expect(ev?.text).toBe('Cleaning west wing');
  });

  // ---------------------------------------------------------------------------
  // Viber webhook — two-step concern flow
  // ---------------------------------------------------------------------------

  it('records a concern via two-step Viber flow', async () => {
    const ts = Date.now();

    await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: ts,
        message_token: `concern-step1-${ts}`,
        chat_id: 'c-concern',
        sender: { id: 'u-concern', name: 'Frank' },
        message: { type: 'text', text: '⚠️ Report concern' },
      });

    const r2 = await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: ts + 1000,
        message_token: `concern-step2-${ts}`,
        chat_id: 'c-concern',
        sender: { id: 'u-concern', name: 'Frank' },
        message: { type: 'text', text: 'The mop is broken' },
      });
    expect(r2.status).toBe(200);

    const concern = await prisma.concern.findFirst({ where: { text: 'The mop is broken' } });
    expect(concern).not.toBeNull();
    expect(concern?.status).toBe('OPEN');

    const ev = await prisma.event.findUnique({
      where: { sourceMessageId: `viber:concern-step2-${ts}` },
    });
    expect(ev?.eventType).toBe('CONCERN');
  });

  // ---------------------------------------------------------------------------
  // Viber webhook — two-step crew-off flow
  // ---------------------------------------------------------------------------

  it('records a crew-off request via two-step Viber flow', async () => {
    const ts = Date.now();

    await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: ts,
        message_token: `crewoff-step1-${ts}`,
        chat_id: 'c-crewoff',
        sender: { id: 'u-crewoff', name: 'Grace' },
        message: { type: 'text', text: '🏖️ Crew off' },
      });

    const r2 = await request(app)
      .post('/webhook/viber')
      .send({
        event: 'message',
        timestamp: ts + 1000,
        message_token: `crewoff-step2-${ts}`,
        chat_id: 'c-crewoff',
        sender: { id: 'u-crewoff', name: 'Grace' },
        message: { type: 'text', text: 'Need Friday off for appointment' },
      });
    expect(r2.status).toBe(200);

    const cr = await prisma.crewOffRequest.findFirst({
      where: { text: 'Need Friday off for appointment' },
    });
    expect(cr).not.toBeNull();
    expect(cr?.status).toBe('PENDING');
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
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /supply-requests filters by status', async () => {
    const res = await request(app)
      .get('/supply-requests')
      .set('x-api-key', adminKey)
      .query({ status: 'DELIVERED' });
    expect(res.status).toBe(200);
    const items: Array<{ status: string }> = res.body.items;
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
    expect(res.body.item.status).toBe('IN_PROGRESS');
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
      data: { provider: 'viber', providerUserId: 'con-u1', name: 'Kate' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'viber', providerChatId: 'con-c1' },
      select: { id: true },
    });
    await prisma.concern.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        text: 'Toilet blocked',
        conversationId: 'con-c1',
        provider: 'viber',
        status: 'OPEN',
      },
    });

    const res = await request(app).get('/concerns').set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const items: Array<{ text: string }> = res.body.items;
    expect(items.some((i) => i.text === 'Toilet blocked')).toBe(true);
  });

  it('PATCH /concerns/:id/status updates to IN_PROGRESS', async () => {
    const user = await prisma.user.create({
      data: { provider: 'viber', providerUserId: 'con-u2', name: 'Leo' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'viber', providerChatId: 'con-c2' },
      select: { id: true },
    });
    const concern = await prisma.concern.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        text: 'Light broken',
        conversationId: 'con-c2',
        provider: 'viber',
        status: 'OPEN',
      },
    });

    const res = await request(app)
      .patch(`/concerns/${concern.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('IN_PROGRESS');
  });

  it('PATCH /concerns/:id/status updates to COMPLETED', async () => {
    const user = await prisma.user.create({
      data: { provider: 'viber', providerUserId: 'con-u3', name: 'Mia' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'viber', providerChatId: 'con-c3' },
      select: { id: true },
    });
    const concern = await prisma.concern.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        text: 'Floor wet',
        conversationId: 'con-c3',
        provider: 'viber',
        status: 'OPEN',
      },
    });

    const res = await request(app)
      .patch(`/concerns/${concern.id}/status`)
      .set('x-api-key', adminKey)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('COMPLETED');
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
      data: { provider: 'viber', providerUserId: 'cr-u1', name: 'Ned' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'viber', providerChatId: 'cr-c1' },
      select: { id: true },
    });
    await prisma.crewOffRequest.create({
      data: { userId: user.id, chatId: chat.id, text: 'Holiday', status: 'PENDING' },
    });

    const res = await request(app).get('/crew-off-requests').set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const items: Array<{ text: string }> = res.body.items;
    expect(items.some((i) => i.text === 'Holiday')).toBe(true);
  });

  it('PATCH /crew-off-requests/:id/status approves a request', async () => {
    const user = await prisma.user.create({
      data: { provider: 'viber', providerUserId: 'cr-u2', name: 'Olivia' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'viber', providerChatId: 'cr-c2' },
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
    expect(res.body.item.status).toBe('APPROVED');
  });

  it('PATCH /crew-off-requests/:id/status denies a request', async () => {
    const user = await prisma.user.create({
      data: { provider: 'viber', providerUserId: 'cr-u3', name: 'Paul' },
      select: { id: true },
    });
    const chat = await prisma.chat.create({
      data: { provider: 'viber', providerChatId: 'cr-c3' },
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
    expect(res.body.item.status).toBe('DENIED');
  });

  // ---------------------------------------------------------------------------
  // Slack webhook — bot reply loop prevention
  // ---------------------------------------------------------------------------

  it('ignores Slack messages with app_id set (bot loop prevention)', async () => {
    const before = await prisma.event.count();

    const res = await request(app)
      .post('/webhook/slack')
      .send({
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
      });

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  it('ignores Slack messages with bot_id set', async () => {
    const before = await prisma.event.count();

    const res = await request(app)
      .post('/webhook/slack')
      .send({
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
      });

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  it('ignores Slack messages with no user field', async () => {
    const before = await prisma.event.count();

    const res = await request(app)
      .post('/webhook/slack')
      .send({
        type: 'event_callback',
        event_id: 'Ev_no_user',
        event_time: Math.floor(Date.now() / 1000),
        event: {
          type: 'message',
          text: 'some automated message',
          channel: 'C_TEST',
          ts: '100.003',
        },
      });

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  it('ignores Slack messages with bot_message subtype', async () => {
    const before = await prisma.event.count();

    const res = await request(app)
      .post('/webhook/slack')
      .send({
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
      });

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(before);
  });

  // ---------------------------------------------------------------------------
  // Slack webhook — url_verification challenge
  // ---------------------------------------------------------------------------

  it('responds to Slack url_verification challenge', async () => {
    const res = await request(app)
      .post('/webhook/slack')
      .send({ type: 'url_verification', challenge: 'abc123' });

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe('abc123');
  });
});
