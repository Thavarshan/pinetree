import { createPrismaClient } from '@pinetree/db';
import { createApp } from './app';
import { getEnv } from './env';

const env = getEnv();
const prisma = createPrismaClient();

const app = createApp({ env, prisma });

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
