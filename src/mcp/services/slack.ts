/**
 * Slack Service
 */

import { WebClient } from '@slack/web-api';
import { getOAuthTokens } from '../db.js';

/**
 * Get Slack client for a user
 */
async function getSlackClient(userId: string, accountName?: string) {
  const tokens = await getOAuthTokens(userId, 'slack');

  if (tokens.length === 0) {
    throw new Error('No Slack account connected. Visit /dashboard to connect Slack.');
  }

  const token = accountName
    ? tokens.find(t => t.accountName.toLowerCase() === accountName.toLowerCase())
    : tokens[0];

  if (!token || !token.accessToken) {
    throw new Error(`Slack account "${accountName}" not found.`);
  }

  return {
    client: new WebClient(token.accessToken),
    workspace: token.accountName,
  };
}

export async function listChannels(
  userId: string,
  account?: string
): Promise<string> {
  const { client, workspace } = await getSlackClient(userId, account);

  const response = await client.conversations.list({
    types: 'public_channel,private_channel',
    limit: 50,
  });

  if (!response.channels || response.channels.length === 0) {
    return `No channels found in ${workspace}.`;
  }

  const formatted = response.channels
    .map((ch, i) => `${i + 1}. #${ch.name} ${ch.is_private ? '(private)' : ''} - ${ch.num_members} members`)
    .join('\n');

  return `Channels in ${workspace}:\n\n${formatted}`;
}

export async function sendMessage(
  userId: string,
  channel: string,
  text: string,
  account?: string
): Promise<string> {
  const { client, workspace } = await getSlackClient(userId, account);

  // Resolve channel name to ID if needed
  let channelId = channel;
  if (channel.startsWith('#')) {
    const channelName = channel.slice(1);
    const response = await client.conversations.list({ types: 'public_channel,private_channel' });
    const found = response.channels?.find(c => c.name === channelName);
    if (!found) {
      throw new Error(`Channel "${channel}" not found in ${workspace}.`);
    }
    channelId = found.id!;
  }

  const response = await client.chat.postMessage({
    channel: channelId,
    text,
  });

  return `Message sent to ${channel} in ${workspace}. Timestamp: ${response.ts}`;
}

export async function readChannel(
  userId: string,
  channel: string,
  options: { limit?: number; account?: string } = {}
): Promise<string> {
  const { limit = 20, account } = options;
  const { client, workspace } = await getSlackClient(userId, account);

  // Resolve channel name to ID
  let channelId = channel;
  if (channel.startsWith('#')) {
    const channelName = channel.slice(1);
    const response = await client.conversations.list({ types: 'public_channel,private_channel' });
    const found = response.channels?.find(c => c.name === channelName);
    if (!found) {
      throw new Error(`Channel "${channel}" not found.`);
    }
    channelId = found.id!;
  }

  const response = await client.conversations.history({
    channel: channelId,
    limit,
  });

  if (!response.messages || response.messages.length === 0) {
    return `No recent messages in ${channel}.`;
  }

  // Get user info for formatting
  const userIds = [...new Set(response.messages.map(m => m.user).filter(Boolean))];
  const userMap = new Map<string, string>();

  for (const uid of userIds) {
    try {
      const userInfo = await client.users.info({ user: uid! });
      userMap.set(uid!, userInfo.user?.real_name || userInfo.user?.name || uid!);
    } catch {
      userMap.set(uid!, uid!);
    }
  }

  const formatted = response.messages
    .reverse()
    .map(m => {
      const user = m.user ? userMap.get(m.user) || m.user : 'Unknown';
      const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toLocaleTimeString() : '';
      return `[${time}] ${user}: ${m.text}`;
    })
    .join('\n');

  return `Recent messages in ${channel} (${workspace}):\n\n${formatted}`;
}
