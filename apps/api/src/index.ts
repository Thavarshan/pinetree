import { createPrismaClient } from '@pinetree/db';
import { createApp } from './app';
import { getEnv } from './env';
import { startReminderJobs } from './reminders';

const env = getEnv();
const prisma = createPrismaClient();

const app = createApp({ env, prisma });

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
  startReminderJobs({ env, prisma });
});
