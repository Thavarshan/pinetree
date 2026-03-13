import { z } from 'zod';

// Minimal subset of Viber webhook payloads we care about.
export const ViberWebhookSchema = z
  .object({
    event: z.string().optional(),
    timestamp: z.number().optional(),
    message_token: z.union([z.number(), z.string()]).optional(),
    chat_id: z.string().optional(),
    sender: z
      .object({
        id: z.string(),
        name: z.string().optional(),
        avatar: z.string().optional(),
      })
      .optional(),
    message: z
      .object({
        text: z.string().optional(),
        type: z.string().optional(),
        media: z.string().optional(),
        file_name: z.string().optional(),
        size: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export type ViberWebhook = z.infer<typeof ViberWebhookSchema>;

export type ViberKeyboard = {
  Type: 'keyboard';
  DefaultHeight?: boolean;
  Buttons: Array<{
    ActionType: 'reply';
    ActionBody: string;
    Text: string;
    BgColor?: string;
    TextSize?: 'regular' | 'large';
    Columns?: number;
    Rows?: number;
  }>;
};

export function buildMenuKeyboard(): ViberKeyboard {
  const buttons = [
    { label: '🟢 Start shift', body: '🟢 Start shift' },
    { label: '☕ Break start', body: '☕ Break start' },
    { label: '✅ Break end', body: '✅ Break end' },
    { label: '🔴 End shift', body: '🔴 End shift' },
    { label: '📝 Status update', body: '📝 Status update' },
    { label: '🛒 Supply request', body: '🛒 Supply request' },
    { label: '⚠️ Report concern', body: '⚠️ Report concern' },
    { label: '🏖️ Crew off', body: '🏖️ Crew off' },
  ];

  return {
    Type: 'keyboard',
    DefaultHeight: true,
    Buttons: buttons.map((b) => ({
      ActionType: 'reply',
      ActionBody: b.body,
      Text: b.label,
      TextSize: 'regular',
      Columns: 6,
      Rows: 1,
    })),
  };
}

export async function viberSendMessage(params: {
  token: string;
  receiver: string;
  text: string;
  keyboard?: ViberKeyboard;
}): Promise<void> {
  const res = await fetch('https://chatapi.viber.com/pa/send_message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Viber-Auth-Token': params.token,
    },
    body: JSON.stringify({
      receiver: params.receiver,
      type: 'text',
      text: params.text,
      keyboard: params.keyboard,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Viber send_message failed: ${res.status} ${res.statusText} ${body}`);
  }
}
