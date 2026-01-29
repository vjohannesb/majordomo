/**
 * Discord Service
 */

import { Client, GatewayIntentBits, TextChannel, DMChannel, ChannelType } from 'discord.js';
import { getOAuthTokens } from '../db.js';

// Cache Discord clients to avoid reconnecting
const clientCache = new Map<string, Client>();

/**
 * Get Discord client for a user
 */
async function getDiscordClient(userId: string, accountName?: string): Promise<{ client: Client; botName: string }> {
  const tokens = await getOAuthTokens(userId, 'discord');

  if (tokens.length === 0) {
    throw new Error('No Discord bot connected. Visit /dashboard to add a Discord bot token.');
  }

  const token = accountName
    ? tokens.find(t => t.accountName.toLowerCase() === accountName.toLowerCase())
    : tokens[0];

  if (!token || !token.accessToken) {
    throw new Error(`Discord account "${accountName}" not found.`);
  }

  const cacheKey = `${userId}:${token.accountName}`;

  // Check cache
  if (clientCache.has(cacheKey)) {
    const cached = clientCache.get(cacheKey)!;
    if (cached.isReady()) {
      return { client: cached, botName: token.accountName };
    }
    // Client not ready, remove from cache
    clientCache.delete(cacheKey);
  }

  // Create new client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  await client.login(token.accessToken);

  // Wait for ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Discord client timeout')), 10000);
    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  clientCache.set(cacheKey, client);

  return { client, botName: token.accountName };
}

export async function listDiscordServers(
  userId: string,
  account?: string
): Promise<string> {
  const { client, botName } = await getDiscordClient(userId, account);

  const guilds = client.guilds.cache;

  if (guilds.size === 0) {
    return `Bot "${botName}" is not in any servers.`;
  }

  const formatted = guilds.map((guild, i) =>
    `${i + 1}. ${guild.name}\n   ID: ${guild.id}\n   Members: ${guild.memberCount}`
  ).join('\n\n');

  return `Discord servers for bot "${botName}":\n\n${formatted}`;
}

export async function listDiscordChannels(
  userId: string,
  serverId: string,
  account?: string
): Promise<string> {
  const { client, botName } = await getDiscordClient(userId, account);

  const guild = client.guilds.cache.get(serverId);
  if (!guild) {
    throw new Error(`Server "${serverId}" not found. Use discord_list_servers to see available servers.`);
  }

  const textChannels = guild.channels.cache.filter(
    ch => ch.type === ChannelType.GuildText
  );

  if (textChannels.size === 0) {
    return `No text channels found in ${guild.name}.`;
  }

  const formatted = textChannels.map((ch, i) =>
    `${i + 1}. #${ch.name}\n   ID: ${ch.id}`
  ).join('\n\n');

  return `Text channels in ${guild.name} (${botName}):\n\n${formatted}`;
}

export async function sendDiscordMessage(
  userId: string,
  channelId: string,
  content: string,
  account?: string
): Promise<string> {
  const { client, botName } = await getDiscordClient(userId, account);

  const channel = await client.channels.fetch(channelId);

  if (!channel) {
    throw new Error(`Channel "${channelId}" not found.`);
  }

  if (!isTextBasedChannel(channel)) {
    throw new Error('Cannot send messages to this channel type.');
  }

  const message = await channel.send(content);

  const channelName = 'name' in channel ? `#${channel.name}` : 'DM';
  return `Message sent to ${channelName} (${botName}).\nMessage ID: ${message.id}`;
}

export async function readDiscordChannel(
  userId: string,
  channelId: string,
  options: { limit?: number; account?: string } = {}
): Promise<string> {
  const { limit = 20, account } = options;
  const { client, botName } = await getDiscordClient(userId, account);

  const channel = await client.channels.fetch(channelId);

  if (!channel) {
    throw new Error(`Channel "${channelId}" not found.`);
  }

  if (!isTextBasedChannel(channel)) {
    throw new Error('Cannot read messages from this channel type.');
  }

  const messages = await channel.messages.fetch({ limit });

  if (messages.size === 0) {
    return 'No messages in this channel.';
  }

  const channelName = 'name' in channel ? `#${channel.name}` : 'DM';

  const formatted = messages
    .reverse()
    .map(msg => {
      const time = msg.createdAt.toLocaleTimeString();
      const author = msg.author.username;
      return `[${time}] ${author}: ${msg.content}`;
    })
    .join('\n');

  return `Recent messages in ${channelName} (${botName}):\n\n${formatted}`;
}

export async function sendDiscordDM(
  userId: string,
  discordUserId: string,
  content: string,
  account?: string
): Promise<string> {
  const { client, botName } = await getDiscordClient(userId, account);

  const user = await client.users.fetch(discordUserId);
  if (!user) {
    throw new Error(`User "${discordUserId}" not found.`);
  }

  const dm = await user.createDM();
  const message = await dm.send(content);

  return `DM sent to ${user.username} (${botName}).\nMessage ID: ${message.id}`;
}

// Type guard for text-based channels
function isTextBasedChannel(channel: any): channel is TextChannel | DMChannel {
  return channel && typeof channel.send === 'function' && typeof channel.messages?.fetch === 'function';
}
