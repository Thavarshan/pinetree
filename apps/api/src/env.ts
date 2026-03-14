import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: process.env.ENV_FILE ?? '.env' });

const EnvSchema = z.object({
  SLACK_SIGNING_SECRET: z.string().optional().default(''),
  SLACK_BOT_TOKEN: z.string().optional().default(''),
  SLACK_CALLCENTRE_CHANNEL_ID: z.string().optional().default(''),
  SLACK_MANAGER_CHANNEL_ID: z.string().optional().default(''),
  PUBLIC_BASE_URL: z.union([z.string().url(), z.literal('')]).default(''),
  TIMEZONE: z.string().default('Asia/Colombo'),
  ADMIN_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  REMINDER_SIGNIN_CRON: z.string().default('0 9 * * 1-5'),
  REMINDER_SIGNOFF_CRON: z.string().default('0 18 * * 1-5'),
  OPENAI_API_KEY: z.string().optional().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Keep this readable in logs.
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${message}`);
  }
  return parsed.data;
}
