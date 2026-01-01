import { EventType, parseEvent } from '@pinetree/core';
import type { PrismaClient } from '@pinetree/db';
import { Prisma } from '@pinetree/db';

import type { Env } from '../env';
import { pendingKey } from '../pendingStatus';
import type { InMemoryPendingStatusStore } from '../pendingStatus';
import type { BotProvider } from './types';

function formatEventConfirmation(eventType: EventType): string {
  switch (eventType) {
    case EventType.SHIFT_START:
      return '✅ Shift started.';
    case EventType.BREAK_START:
      return '☕ Break started.';
    case EventType.BREAK_END:
      return '✅ Break ended.';
    case EventType.SHIFT_END:
      return '🏁 Shift ended.';
    default:
      return `Recorded: ${eventType}`;
  }
}

export type SendMessage = (params: {
  conversationId: string;
  text: string;
  showMenu?: boolean;
}) => Promise<void>;

export async function handleIncomingMessage(params: {
  provider: BotProvider;
  env: Env;
  prisma: PrismaClient;
  pendingStatus: InMemoryPendingStatusStore;
  seenUserChats: Set<string>;

  providerUserId: string;
  userName: string;
  avatarUrl?: string;

  providerChatId?: string;
  conversationId: string;

  messageText: string;
  sourceMessageId: string;
  rawPayload: unknown;
  createdAt: Date;

  sendMessage: SendMessage;
}): Promise<void> {
  const {
    provider,
    env,
    prisma,
    pendingStatus,
    seenUserChats,
    providerUserId,
    userName,
    avatarUrl,
    providerChatId,
    conversationId,
    messageText,
    sourceMessageId,
    rawPayload,
    createdAt,
    sendMessage,
  } = params;

  const normalizedSourceMessageId = `${provider}:${sourceMessageId}`;

  const key = pendingKey(providerChatId, providerUserId);
  const sawPending = pendingStatus.consumeIfPending(key);

  if (sawPending) {
    const { user, chat } = await upsertUserChat({
      prisma,
      provider,
      providerUserId,
      userName,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(providerChatId ? { providerChatId } : {}),
    });

    await insertEventIdempotent({
      prisma,
      chatId: chat.id,
      userId: user.id,
      eventType: EventType.STATUS,
      text: messageText,
      sourceMessageId: normalizedSourceMessageId,
      rawPayload,
      createdAt,
    });

    const trimmed = messageText.trim();
    await sendMessage({
      conversationId,
      text: trimmed ? `✅ Status saved: "${trimmed}"` : '✅ Status saved.',
      showMenu: true,
    });
    return;
  }

  const source = messageText.trim().startsWith('/')
    ? 'command'
    : messageText.trim().toLowerCase() === 'menu'
      ? 'unknown'
      : 'free_text';

  const result = parseEvent(messageText, { timezone: env.TIMEZONE, source });

  if (result.kind === 'menu') {
    await sendMessage({ conversationId, text: 'Choose an action:', showMenu: true });
    return;
  }

  if (result.kind === 'status_pending') {
    pendingStatus.setPending(key, 2 * 60 * 1000);
    await sendMessage({
      conversationId,
      text: "What's your status? Reply with a short message.",
    });
    return;
  }

  if (result.kind !== 'event') {
    const seenKey = `${provider}::${providerChatId ?? 'private'}::${providerUserId}`;
    if (!seenUserChats.has(seenKey)) {
      seenUserChats.add(seenKey);
      await sendMessage({ conversationId, text: 'Choose an action:', showMenu: true });
    }
    return;
  }

  const { user, chat } = await upsertUserChat({
    prisma,
    provider,
    providerUserId,
    userName,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(providerChatId ? { providerChatId } : {}),
  });

  await insertEventIdempotent({
    prisma,
    chatId: chat.id,
    userId: user.id,
    eventType: result.eventType,
    ...('text' in result && typeof result.text === 'string' ? { text: result.text } : {}),
    sourceMessageId: normalizedSourceMessageId,
    rawPayload,
    createdAt,
  });

  await sendMessage({
    conversationId,
    text: formatEventConfirmation(result.eventType),
    showMenu: true,
  });
}

async function upsertUserChat(params: {
  prisma: PrismaClient;
  provider: BotProvider;
  providerUserId: string;
  userName: string;
  avatarUrl?: string;
  providerChatId?: string;
}): Promise<{ user: { id: string }; chat: { id: string } }> {
  const user = await params.prisma.user.upsert({
    where: {
      provider_providerUserId: { provider: params.provider, providerUserId: params.providerUserId },
    },
    create: {
      provider: params.provider,
      providerUserId: params.providerUserId,
      name: params.userName,
      ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
    },
    update: {
      name: params.userName,
      ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : { avatarUrl: null }),
    },
    select: { id: true },
  });

  const providerChatId = params.providerChatId ?? `private:${params.providerUserId}`;
  const chat = await params.prisma.chat.upsert({
    where: {
      provider_providerChatId: { provider: params.provider, providerChatId },
    },
    create: { provider: params.provider, providerChatId },
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
        ...(typeof params.text === 'string' ? { text: params.text } : {}),
        sourceMessageId: params.sourceMessageId,
        rawPayload: JSON.stringify(params.rawPayload),
        createdAt: params.createdAt,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return;
    }
    throw e;
  }
}
