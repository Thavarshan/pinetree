import { EventType, parseEvent } from '@pinetree/core';
import type { PrismaClient } from '@pinetree/db';
import { Prisma } from '@pinetree/db';

import type { Env } from '../env';
import type { PendingConversationStore } from '../pendingStatus';
import { pendingKey } from '../pendingStatus';
import { notifySlackChannel } from '../slack';
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
    case EventType.SUPPLY_REQUEST:
      return '✅ Supply request submitted.';
    case EventType.CONCERN:
      return '✅ Concern received.';
    case EventType.CREW_OFF:
      return '✅ Crew-off request submitted.';
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
  pendingStatus: PendingConversationStore;
  seenUserChats: Set<string>;

  providerUserId: string;
  userName: string;
  avatarUrl?: string;

  providerChatId?: string;
  chatName?: string;
  conversationId: string;

  messageText: string;
  sourceMessageId: string;
  rawPayload: unknown;
  createdAt: Date;

  mediaUrl?: string;
  mediaType?: string;

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
    chatName,
    conversationId,
    messageText,
    sourceMessageId,
    rawPayload,
    createdAt,
    mediaUrl,
    mediaType,
    sendMessage,
  } = params;

  const normalizedSourceMessageId = `${provider}:${sourceMessageId}`;

  const key = pendingKey(providerChatId, providerUserId);
  const pendingState = pendingStatus.consumeIfPending(key);

  if (pendingState) {
    const { user, chat } = await upsertUserChat({
      prisma,
      provider,
      providerUserId,
      userName,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(providerChatId ? { providerChatId } : {}),
      ...(chatName ? { chatName } : {}),
    });

    if (pendingState.type === 'status') {
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
    } else if (pendingState.type === 'concern') {
      await insertEventIdempotent({
        prisma,
        chatId: chat.id,
        userId: user.id,
        eventType: EventType.CONCERN,
        text: messageText,
        sourceMessageId: normalizedSourceMessageId,
        rawPayload,
        createdAt,
      });

      await prisma.concern.create({
        data: {
          userId: user.id,
          chatId: chat.id,
          text: messageText,
          conversationId,
          provider,
          status: 'OPEN',
        },
      });

      await notifySlackChannel({
        token: env.SLACK_BOT_TOKEN,
        channelId: env.SLACK_CALLCENTRE_CHANNEL_ID,
        text: `🚨 New concern from *${userName}*:\n${messageText}`,
      });

      await sendMessage({
        conversationId,
        text: '✅ Your concern has been received. A team member will follow up shortly.',
        showMenu: true,
      });
    } else if (pendingState.type === 'crew_off') {
      await insertEventIdempotent({
        prisma,
        chatId: chat.id,
        userId: user.id,
        eventType: EventType.CREW_OFF,
        text: messageText,
        sourceMessageId: normalizedSourceMessageId,
        rawPayload,
        createdAt,
      });

      await prisma.crewOffRequest.create({
        data: {
          userId: user.id,
          chatId: chat.id,
          text: messageText,
          status: 'PENDING',
        },
      });

      const notifText = `🏖️ Crew-off request from *${userName}*:\n${messageText}`;
      await notifySlackChannel({
        token: env.SLACK_BOT_TOKEN,
        channelId: env.SLACK_MANAGER_CHANNEL_ID,
        text: notifText,
      });
      await notifySlackChannel({
        token: env.SLACK_BOT_TOKEN,
        channelId: env.SLACK_CALLCENTRE_CHANNEL_ID,
        text: notifText,
      });

      await sendMessage({
        conversationId,
        text: '✅ Your crew-off request has been submitted and escalated to the manager.',
        showMenu: true,
      });
    } else if (pendingState.type === 'supply_request') {
      await insertEventIdempotent({
        prisma,
        chatId: chat.id,
        userId: user.id,
        eventType: EventType.SUPPLY_REQUEST,
        text: messageText,
        sourceMessageId: normalizedSourceMessageId,
        rawPayload,
        createdAt,
      });

      await prisma.supplyRequest.create({
        data: {
          userId: user.id,
          chatId: chat.id,
          text: messageText,
          clientLocation: providerChatId ?? null,
          status: 'PENDING',
        },
      });

      await notifySlackChannel({
        token: env.SLACK_BOT_TOKEN,
        channelId: env.SLACK_CALLCENTRE_CHANNEL_ID,
        text: `🛒 Supply request from *${userName}*:\n${messageText}`,
      });

      await sendMessage({
        conversationId,
        text: '✅ Supply request submitted.',
        showMenu: true,
      });
    }

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
    pendingStatus.setPending(key, { type: 'status' }, 2 * 60 * 1000);
    await sendMessage({
      conversationId,
      text: "What's your status? Reply with a short message.",
    });
    return;
  }

  if (result.kind === 'supply_request_pending') {
    pendingStatus.setPending(key, { type: 'supply_request' }, 2 * 60 * 1000);
    await sendMessage({
      conversationId,
      text: 'What supplies do you need? Reply with details.',
    });
    return;
  }

  if (result.kind === 'concern_pending') {
    pendingStatus.setPending(key, { type: 'concern' }, 2 * 60 * 1000);
    await sendMessage({
      conversationId,
      text: 'Please describe your concern and we will pass it on to the team.',
    });
    return;
  }

  if (result.kind === 'crew_off_pending') {
    pendingStatus.setPending(key, { type: 'crew_off' }, 2 * 60 * 1000);
    await sendMessage({
      conversationId,
      text: 'Please provide details for your crew-off request (dates, reason, etc.).',
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

  // Optional transcription for audio/voice media when OpenAI key is available.
  let transcript: string | undefined;
  if (mediaUrl && mediaType && env.OPENAI_API_KEY) {
    const audioTypes = ['audio', 'voice'];
    if (audioTypes.some((t) => mediaType.includes(t))) {
      transcript = await transcribeAudio(mediaUrl, env.OPENAI_API_KEY).catch(() => undefined);
    }
  }

  const { user, chat } = await upsertUserChat({
    prisma,
    provider,
    providerUserId,
    userName,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(providerChatId ? { providerChatId } : {}),
    ...(chatName ? { chatName } : {}),
  });

  await insertEventIdempotent({
    prisma,
    chatId: chat.id,
    userId: user.id,
    eventType: result.eventType,
    ...('text' in result && typeof result.text === 'string' ? { text: result.text } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(transcript ? { transcript } : {}),
    sourceMessageId: normalizedSourceMessageId,
    rawPayload,
    createdAt,
  });

  // SUPPLY_REQUEST: create a dedicated SupplyRequest record and notify call centre.
  if (result.eventType === EventType.SUPPLY_REQUEST) {
    const supplyText = 'text' in result && typeof result.text === 'string' ? result.text : null;
    await prisma.supplyRequest.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        ...(supplyText ? { text: supplyText } : {}),
        clientLocation: providerChatId ?? null,
        status: 'PENDING',
      },
    });

    const notifMsg = supplyText
      ? `🛒 Supply request from *${userName}*:\n${supplyText}`
      : `🛒 Supply request from *${userName}* in ${providerChatId ?? 'direct message'}.`;
    await notifySlackChannel({
      token: env.SLACK_BOT_TOKEN,
      channelId: env.SLACK_CALLCENTRE_CHANNEL_ID,
      text: notifMsg,
    });
  }

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
  chatName?: string;
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
    create: {
      provider: params.provider,
      providerChatId,
      ...(params.chatName ? { name: params.chatName } : {}),
    },
    update: {
      ...(params.chatName ? { name: params.chatName } : {}),
    },
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
  mediaUrl?: string;
  mediaType?: string;
  transcript?: string;
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
        ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
        ...(params.mediaType ? { mediaType: params.mediaType } : {}),
        ...(params.transcript ? { transcript: params.transcript } : {}),
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

async function transcribeAudio(mediaUrl: string, apiKey: string): Promise<string> {
  // Fetch the audio file and send it to OpenAI Whisper for transcription.
  const audioRes = await fetch(mediaUrl);
  if (!audioRes.ok) throw new Error(`Failed to fetch audio: ${audioRes.status}`);

  const audioBlob = await audioRes.blob();
  const form = new FormData();
  form.append('file', audioBlob, 'audio.ogg');
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Whisper API error: ${res.status}`);
  const json = (await res.json()) as { text?: string };
  return json.text ?? '';
}
