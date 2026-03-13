import type { PrismaClient } from '@pinetree/db';
import { DateTime } from 'luxon';
import cron from 'node-cron';

import type { Env } from './env';
import { slackSendMessage } from './slack';
import { viberSendMessage } from './viber';

async function sendReminder(params: {
  env: Env;
  prisma: PrismaClient;
  userId: string;
  text: string;
}): Promise<void> {
  const { env, prisma, userId, text } = params;
  const recentEvent = await prisma.event.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { chat: true },
  });
  if (!recentEvent) return;

  const { chat } = recentEvent;
  if (chat.provider === 'viber' && env.VIBER_BOT_TOKEN) {
    await viberSendMessage({
      token: env.VIBER_BOT_TOKEN,
      receiver: chat.providerChatId,
      text,
    }).catch((e: unknown) => console.error('[reminder viber]', e));
  } else if (chat.provider === 'slack' && env.SLACK_BOT_TOKEN) {
    await slackSendMessage({
      token: env.SLACK_BOT_TOKEN,
      channel: chat.providerChatId,
      text,
    }).catch((e: unknown) => console.error('[reminder slack]', e));
  }
}

export function startReminderJobs(params: { env: Env; prisma: PrismaClient }): void {
  const { env, prisma } = params;

  // Sign-in reminder: notify cleaners who haven't started their shift today.
  cron.schedule(env.REMINDER_SIGNIN_CRON, async () => {
    const now = DateTime.now().setZone(env.TIMEZONE);
    const startOfDay = now.startOf('day').toUTC().toJSDate();
    const endOfDay = now.endOf('day').toUTC().toJSDate();

    // All users who have ever signed in (active in the system).
    const users = await prisma.user.findMany({
      where: { events: { some: { eventType: 'SHIFT_START' } } },
      select: { id: true, name: true },
    });

    // Users who already started their shift today.
    const alreadyStarted = new Set(
      (
        await prisma.event.findMany({
          where: { eventType: 'SHIFT_START', createdAt: { gte: startOfDay, lte: endOfDay } },
          select: { userId: true },
        })
      ).map((e) => e.userId),
    );

    const absent = users.filter((u) => !alreadyStarted.has(u.id));

    for (const user of absent) {
      await sendReminder({
        env,
        prisma,
        userId: user.id,
        text: '⏰ Reminder: You have not signed in yet today. Please sign in when you start your shift.',
      });
    }

    if (absent.length > 0 && env.SLACK_CALLCENTRE_CHANNEL_ID && env.SLACK_BOT_TOKEN) {
      const names = absent.map((u) => `• ${u.name}`).join('\n');
      await slackSendMessage({
        token: env.SLACK_BOT_TOKEN,
        channel: env.SLACK_CALLCENTRE_CHANNEL_ID,
        text: `⚠️ The following cleaners have not signed in today:\n${names}`,
      }).catch((e: unknown) => console.error('[reminder callcentre]', e));
    }
  });

  // Sign-off reminder: notify cleaners who started a shift but haven't ended it.
  cron.schedule(env.REMINDER_SIGNOFF_CRON, async () => {
    const now = DateTime.now().setZone(env.TIMEZONE);
    const startOfDay = now.startOf('day').toUTC().toJSDate();
    const endOfDay = now.endOf('day').toUTC().toJSDate();

    const startedUserIds = new Set(
      (
        await prisma.event.findMany({
          where: { eventType: 'SHIFT_START', createdAt: { gte: startOfDay, lte: endOfDay } },
          select: { userId: true },
        })
      ).map((e) => e.userId),
    );

    const endedUserIds = new Set(
      (
        await prisma.event.findMany({
          where: { eventType: 'SHIFT_END', createdAt: { gte: startOfDay, lte: endOfDay } },
          select: { userId: true },
        })
      ).map((e) => e.userId),
    );

    const notSignedOff = [...startedUserIds].filter((id) => !endedUserIds.has(id));

    const users = await prisma.user.findMany({
      where: { id: { in: notSignedOff } },
      select: { id: true, name: true },
    });

    for (const user of users) {
      await sendReminder({
        env,
        prisma,
        userId: user.id,
        text: "⏰ Reminder: Don't forget to sign off at the end of your shift.",
      });
    }

    if (users.length > 0 && env.SLACK_CALLCENTRE_CHANNEL_ID && env.SLACK_BOT_TOKEN) {
      const names = users.map((u) => `• ${u.name}`).join('\n');
      await slackSendMessage({
        token: env.SLACK_BOT_TOKEN,
        channel: env.SLACK_CALLCENTRE_CHANNEL_ID,
        text: `⚠️ The following cleaners have not signed off today:\n${names}`,
      }).catch((e: unknown) => console.error('[reminder callcentre]', e));
    }
  });
}
