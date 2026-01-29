/**
 * Notification Service
 *
 * Routes notifications to the user's preferred channel (Slack, email).
 */

import { getUserSettings, getOAuthTokens } from '../db.js';
import { sendEmail } from './google.js';

interface NotificationPayload {
  title: string;
  message: string;
  source: 'linear' | 'notion' | 'slack' | 'google' | 'system';
  url?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Send a notification to the user via their preferred channel
 */
export async function sendNotification(
  userId: string,
  payload: NotificationPayload
): Promise<{ success: boolean; channel?: string; error?: string }> {
  try {
    const settings = await getUserSettings(userId);

    if (!settings || settings.notificationChannel === 'none') {
      console.log(`Notification skipped for user ${userId}: notifications disabled`);
      return { success: true, channel: 'none' };
    }

    const channel = settings.notificationChannel;

    if (channel === 'slack') {
      return await sendSlackNotification(userId, payload, settings.slackChannelId);
    } else if (channel === 'email') {
      return await sendEmailNotification(userId, payload);
    }

    return { success: false, error: 'Unknown notification channel' };
  } catch (error) {
    console.error('Failed to send notification:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Send notification via Slack DM or channel
 */
async function sendSlackNotification(
  userId: string,
  payload: NotificationPayload,
  channelId?: string
): Promise<{ success: boolean; channel: string; error?: string }> {
  const slackTokens = await getOAuthTokens(userId, 'slack');

  if (slackTokens.length === 0) {
    return { success: false, channel: 'slack', error: 'No Slack account connected' };
  }

  const token = slackTokens[0];
  if (!token.accessToken) {
    return { success: false, channel: 'slack', error: 'No Slack access token' };
  }

  // Format message with optional link
  const sourceEmoji = {
    linear: ':linear:',
    notion: ':notion:',
    slack: ':slack:',
    google: ':google:',
    system: ':robot_face:',
  }[payload.source] || ':bell:';

  let text = `${sourceEmoji} *${payload.title}*\n${payload.message}`;
  if (payload.url) {
    text += `\n<${payload.url}|View in ${payload.source}>`;
  }

  // If no channel specified, try to DM the bot user (self)
  // In practice, you'd want to get the user's Slack user ID and DM them
  const targetChannel = channelId || token.tokenData?.botUserId;

  if (!targetChannel) {
    return { success: false, channel: 'slack', error: 'No Slack channel configured' };
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: targetChannel,
      text,
      unfurl_links: false,
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    return { success: false, channel: 'slack', error: data.error };
  }

  return { success: true, channel: 'slack' };
}

/**
 * Send notification via email (using connected Google account)
 */
async function sendEmailNotification(
  userId: string,
  payload: NotificationPayload
): Promise<{ success: boolean; channel: string; error?: string }> {
  const googleTokens = await getOAuthTokens(userId, 'google');

  if (googleTokens.length === 0) {
    return { success: false, channel: 'email', error: 'No Google account connected' };
  }

  const token = googleTokens[0];
  const userEmail = token.accountName; // Email is stored as accountName for Google

  // Build email body
  let body = payload.message;
  if (payload.url) {
    body += `\n\nView: ${payload.url}`;
  }

  try {
    await sendEmail(userId, {
      to: userEmail,
      subject: `[Majordomo] ${payload.title}`,
      body,
    });
    return { success: true, channel: 'email' };
  } catch (error) {
    return { success: false, channel: 'email', error: String(error) };
  }
}

/**
 * Format Linear webhook event as notification
 */
export function formatLinearNotification(
  action: string,
  type: string,
  data: Record<string, unknown>,
  actor?: { name?: string }
): NotificationPayload | null {
  const actorName = actor?.name || 'Someone';

  switch (type) {
    case 'Issue': {
      const title = data.title as string;
      const identifier = data.identifier as string;
      const state = (data.state as Record<string, unknown>)?.name as string;
      const url = data.url as string;

      if (action === 'create') {
        return {
          title: `New Issue: ${identifier}`,
          message: `${actorName} created "${title}"`,
          source: 'linear',
          url,
        };
      } else if (action === 'update' && state?.toLowerCase().includes('done')) {
        return {
          title: `Issue Completed: ${identifier}`,
          message: `"${title}" was marked as ${state}`,
          source: 'linear',
          url,
        };
      }
      break;
    }

    case 'Comment': {
      const body = (data.body as string)?.slice(0, 200);
      const issueId = (data.issue as Record<string, unknown>)?.identifier as string;
      const url = data.url as string;

      if (action === 'create') {
        return {
          title: `New Comment on ${issueId}`,
          message: `${actorName}: ${body}${body?.length >= 200 ? '...' : ''}`,
          source: 'linear',
          url,
        };
      }
      break;
    }

    case 'Project': {
      const name = data.name as string;
      const url = data.url as string;

      if (action === 'create') {
        return {
          title: 'New Project Created',
          message: `${actorName} created project "${name}"`,
          source: 'linear',
          url,
        };
      }
      break;
    }
  }

  return null;
}

/**
 * Format Notion webhook event as notification
 */
export function formatNotionNotification(
  eventType: string,
  data: Record<string, unknown>
): NotificationPayload | null {
  const pageId = (data.entity as Record<string, unknown>)?.id as string;
  // Note: Notion webhooks don't include page title, you'd need to fetch it

  switch (eventType) {
    case 'page.content_updated':
      return {
        title: 'Page Updated',
        message: `A Notion page was updated`,
        source: 'notion',
        url: `https://notion.so/${pageId?.replace(/-/g, '')}`,
        metadata: { pageId },
      };

    case 'page.created':
      return {
        title: 'New Page Created',
        message: `A new Notion page was created`,
        source: 'notion',
        url: `https://notion.so/${pageId?.replace(/-/g, '')}`,
        metadata: { pageId },
      };

    case 'page.deleted':
      return {
        title: 'Page Deleted',
        message: `A Notion page was deleted`,
        source: 'notion',
        metadata: { pageId },
      };

    case 'comment.created':
      return {
        title: 'New Comment',
        message: `Someone commented on a Notion page`,
        source: 'notion',
        url: `https://notion.so/${pageId?.replace(/-/g, '')}`,
        metadata: { pageId },
      };

    case 'page.permissions_updated':
      return {
        title: 'Permissions Changed',
        message: `Page permissions were updated`,
        source: 'notion',
        url: `https://notion.so/${pageId?.replace(/-/g, '')}`,
        metadata: { pageId },
      };
  }

  return null;
}
