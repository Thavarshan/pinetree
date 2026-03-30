// Shared Slack API helpers used by slackAdapter, shared message handler, app routes, and reminders.

export type SlackPostMessageResponse = { ok: boolean; error?: string };

export type SlackUsersInfoResponse =
  | {
      ok: true;
      user: {
        id: string;
        real_name?: string;
        name?: string;
        profile?: {
          display_name?: string;
          real_name?: string;
          image_192?: string;
          image_72?: string;
        };
      };
    }
  | { ok: false; error?: string };

export async function slackSendMessage(params: {
  token: string;
  channel: string;
  text: string;
  blocks?: object[];
}): Promise<void> {
  const body: Record<string, unknown> = {
    channel: params.channel,
    text: params.text,
  };
  if (params.blocks && params.blocks.length > 0) {
    body.blocks = params.blocks;
  }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as SlackPostMessageResponse | null;

  if (!res.ok || !json || json.ok !== true) {
    const err = json && json.ok === false ? json.error : `${res.status} ${res.statusText}`;
    throw new Error(`Slack chat.postMessage failed: ${err}`);
  }
}

/** Update an existing Slack message (e.g. to remove Block Kit buttons after a click). */
export async function slackUpdateMessage(params: {
  token: string;
  channel: string;
  ts: string;
  text: string;
  blocks?: object[];
}): Promise<void> {
  const body: Record<string, unknown> = {
    channel: params.channel,
    ts: params.ts,
    text: params.text,
  };
  if (params.blocks) {
    body.blocks = params.blocks;
  }

  const res = await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as SlackPostMessageResponse | null;

  if (!res.ok || !json || json.ok !== true) {
    const err = json && json.ok === false ? json.error : `${res.status} ${res.statusText}`;
    throw new Error(`Slack chat.update failed: ${err}`);
  }
}

export async function slackGetUserProfile(params: {
  token: string;
  userId: string;
}): Promise<{ name: string; avatarUrl?: string } | null> {
  const url = new URL('https://slack.com/api/users.info');
  url.searchParams.set('user', params.userId);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.token}`,
    },
  });

  const json = (await res.json().catch(() => null)) as SlackUsersInfoResponse | null;
  if (!res.ok || !json || json.ok !== true) {
    return null;
  }

  const profile = json.user.profile;
  const name =
    profile?.display_name?.trim() ||
    profile?.real_name?.trim() ||
    json.user.real_name?.trim() ||
    json.user.name?.trim() ||
    json.user.id;

  const avatarUrl = profile?.image_192 ?? profile?.image_72;

  return avatarUrl ? { name, avatarUrl } : { name };
}

/** Best-effort: silently swallows errors so callers don't fail on notification issues. */
export async function notifySlackChannel(params: {
  token: string | undefined;
  channelId: string | undefined;
  text: string;
}): Promise<void> {
  if (!params.token || !params.channelId) return;
  await slackSendMessage({
    token: params.token,
    channel: params.channelId,
    text: params.text,
  }).catch((e: unknown) => console.error('[slack notify]', e));
}

export async function slackGetChannelInfo(params: {
  token: string;
  channelId: string;
}): Promise<{ name: string } | null> {
  const url = new URL('https://slack.com/api/conversations.info');
  url.searchParams.set('channel', params.channelId);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.token}` },
  });

  const json = (await res.json().catch(() => null)) as {
    ok: boolean;
    channel?: { name?: string };
    error?: string;
  } | null;

  if (!res.ok || !json || !json.ok || !json.channel?.name) return null;
  return { name: json.channel.name };
}
