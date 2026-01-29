/**
 * Discord Service
 *
 * Supports both:
 * - OAuth tokens (user tokens from OAuth flow)
 * - Bot tokens (for full messaging capabilities)
 *
 * OAuth tokens can list user's guilds but need a bot for messaging.
 * When using OAuth with bot scope, the bot is added to selected server.
 */

import { Client, GatewayIntentBits, TextChannel, DMChannel, ChannelType } from 'discord.js';
import { getOAuthTokens } from '../db.js';

const DISCORD_API = 'https://discord.com/api/v10';

// Cache Discord bot clients
const botClientCache = new Map<string, Client>();

interface DiscordToken {
  accessToken: string;
  accountName: string;
  tokenData?: {
    discordUserId?: string;
    username?: string;
    scope?: string;
    guild?: { id: string; name: string };
  };
}

/**
 * Get Discord token for a user
 */
async function getDiscordToken(userId: string, accountName?: string): Promise<DiscordToken> {
  const tokens = await getOAuthTokens(userId, 'discord');

  if (tokens.length === 0) {
    throw new Error('No Discord account connected. Visit /dashboard to connect Discord.');
  }

  const token = accountName
    ? tokens.find(t => t.accountName.toLowerCase() === accountName.toLowerCase())
    : tokens[0];

  if (!token || !token.accessToken) {
    throw new Error(`Discord account "${accountName}" not found.`);
  }

  return {
    accessToken: token.accessToken,
    accountName: token.accountName,
    tokenData: token.tokenData as DiscordToken['tokenData'],
  };
}

/**
 * Check if token is a bot token (vs OAuth user token)
 */
function isBotToken(token: string): boolean {
  // Bot tokens are typically longer and have a specific format
  // OAuth tokens are shorter Bearer tokens
  return token.length > 70 || token.startsWith('Bot ');
}

/**
 * Get or create a Discord.js client for bot tokens
 */
async function getBotClient(token: string, cacheKey: string): Promise<Client> {
  if (botClientCache.has(cacheKey)) {
    const cached = botClientCache.get(cacheKey)!;
    if (cached.isReady()) {
      return cached;
    }
    botClientCache.delete(cacheKey);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  const cleanToken = token.replace('Bot ', '');
  await client.login(cleanToken);

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

  botClientCache.set(cacheKey, client);
  return client;
}

/**
 * Make a Discord API request with OAuth token
 */
async function discordApi(endpoint: string, token: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`${DISCORD_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Discord API error: ${data.message || response.statusText}`);
  }

  return data;
}

// ============================================================================
// Public API
// ============================================================================

export async function listDiscordServers(
  userId: string,
  account?: string
): Promise<string> {
  const token = await getDiscordToken(userId, account);

  if (isBotToken(token.accessToken)) {
    // Use discord.js for bot tokens
    const client = await getBotClient(token.accessToken, `${userId}:${token.accountName}`);
    const guilds = client.guilds.cache;

    if (guilds.size === 0) {
      return `Bot "${token.accountName}" is not in any servers.`;
    }

    const formatted = Array.from(guilds.values()).map((guild, i) =>
      `${i + 1}. ${guild.name}\n   ID: ${guild.id}\n   Members: ${guild.memberCount}`
    ).join('\n\n');

    return `Discord servers (${token.accountName}):\n\n${formatted}`;
  } else {
    // Use REST API for OAuth tokens
    const guilds = await discordApi('/users/@me/guilds', token.accessToken);

    if (guilds.length === 0) {
      return `No servers found for ${token.accountName}.`;
    }

    const formatted = guilds.map((guild: any, i: number) =>
      `${i + 1}. ${guild.name}${guild.owner ? ' (Owner)' : ''}\n   ID: ${guild.id}`
    ).join('\n\n');

    return `Your Discord servers (${token.accountName}):\n\n${formatted}`;
  }
}

export async function listDiscordChannels(
  userId: string,
  serverId: string,
  account?: string
): Promise<string> {
  const token = await getDiscordToken(userId, account);

  if (isBotToken(token.accessToken)) {
    const client = await getBotClient(token.accessToken, `${userId}:${token.accountName}`);
    const guild = client.guilds.cache.get(serverId);

    if (!guild) {
      throw new Error(`Server "${serverId}" not found. The bot may not be in this server.`);
    }

    const textChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText);

    if (textChannels.size === 0) {
      return `No text channels found in ${guild.name}.`;
    }

    const formatted = Array.from(textChannels.values()).map((ch, i) =>
      `${i + 1}. #${ch.name}\n   ID: ${ch.id}`
    ).join('\n\n');

    return `Text channels in ${guild.name}:\n\n${formatted}`;
  } else {
    // OAuth tokens can get guild channels if user has access
    try {
      const channels = await discordApi(`/guilds/${serverId}/channels`, token.accessToken);
      const textChannels = channels.filter((ch: any) => ch.type === 0); // Type 0 = text channel

      if (textChannels.length === 0) {
        return 'No text channels found.';
      }

      const formatted = textChannels.map((ch: any, i: number) =>
        `${i + 1}. #${ch.name}\n   ID: ${ch.id}`
      ).join('\n\n');

      return `Text channels:\n\n${formatted}`;
    } catch (error) {
      throw new Error(`Cannot list channels. Make sure the bot has been added to this server. Error: ${error}`);
    }
  }
}

export async function sendDiscordMessage(
  userId: string,
  channelId: string,
  content: string,
  account?: string
): Promise<string> {
  const token = await getDiscordToken(userId, account);

  if (isBotToken(token.accessToken)) {
    const client = await getBotClient(token.accessToken, `${userId}:${token.accountName}`);
    const channel = await client.channels.fetch(channelId);

    if (!channel || !isTextBasedChannel(channel)) {
      throw new Error(`Channel "${channelId}" not found or not a text channel.`);
    }

    const message = await channel.send(content);
    const channelName = 'name' in channel ? `#${channel.name}` : 'DM';
    return `Message sent to ${channelName}.\nMessage ID: ${message.id}`;
  } else {
    // Try using REST API (works if bot has been added with message permissions)
    try {
      const message = await discordApi(`/channels/${channelId}/messages`, token.accessToken, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      return `Message sent.\nMessage ID: ${message.id}`;
    } catch (error) {
      throw new Error(`Cannot send message. The bot needs to be added to this server with message permissions. Error: ${error}`);
    }
  }
}

export async function readDiscordChannel(
  userId: string,
  channelId: string,
  options: { limit?: number; account?: string } = {}
): Promise<string> {
  const { limit = 20, account } = options;
  const token = await getDiscordToken(userId, account);

  if (isBotToken(token.accessToken)) {
    const client = await getBotClient(token.accessToken, `${userId}:${token.accountName}`);
    const channel = await client.channels.fetch(channelId);

    if (!channel || !isTextBasedChannel(channel)) {
      throw new Error(`Channel "${channelId}" not found or not a text channel.`);
    }

    const messages = await channel.messages.fetch({ limit });

    if (messages.size === 0) {
      return 'No messages in this channel.';
    }

    const channelName = 'name' in channel ? `#${channel.name}` : 'DM';
    const formatted = Array.from(messages.values())
      .reverse()
      .map(msg => {
        const time = msg.createdAt.toLocaleTimeString();
        return `[${time}] ${msg.author.username}: ${msg.content}`;
      })
      .join('\n');

    return `Recent messages in ${channelName}:\n\n${formatted}`;
  } else {
    // REST API
    try {
      const messages = await discordApi(`/channels/${channelId}/messages?limit=${limit}`, token.accessToken);

      if (messages.length === 0) {
        return 'No messages in this channel.';
      }

      const formatted = messages
        .reverse()
        .map((msg: any) => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          return `[${time}] ${msg.author.username}: ${msg.content}`;
        })
        .join('\n');

      return `Recent messages:\n\n${formatted}`;
    } catch (error) {
      throw new Error(`Cannot read messages. Error: ${error}`);
    }
  }
}

export async function sendDiscordDM(
  userId: string,
  discordUserId: string,
  content: string,
  account?: string
): Promise<string> {
  const token = await getDiscordToken(userId, account);

  if (isBotToken(token.accessToken)) {
    const client = await getBotClient(token.accessToken, `${userId}:${token.accountName}`);
    const user = await client.users.fetch(discordUserId);

    if (!user) {
      throw new Error(`User "${discordUserId}" not found.`);
    }

    const dm = await user.createDM();
    const message = await dm.send(content);
    return `DM sent to ${user.username}.\nMessage ID: ${message.id}`;
  } else {
    // Create DM channel and send via REST
    try {
      const dmChannel = await discordApi('/users/@me/channels', token.accessToken, {
        method: 'POST',
        body: JSON.stringify({ recipient_id: discordUserId }),
      });

      const message = await discordApi(`/channels/${dmChannel.id}/messages`, token.accessToken, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });

      return `DM sent.\nMessage ID: ${message.id}`;
    } catch (error) {
      throw new Error(`Cannot send DM. Error: ${error}`);
    }
  }
}

// Type guard for text-based channels
function isTextBasedChannel(channel: any): channel is TextChannel | DMChannel {
  return channel && typeof channel.send === 'function' && typeof channel.messages?.fetch === 'function';
}
