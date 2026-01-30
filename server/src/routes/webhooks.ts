/**
 * Webhook Routes
 *
 * Handles incoming webhooks from Linear, Notion, etc.
 */

import { Hono } from 'hono';
import * as crypto from 'node:crypto';
import { sql, getWebhookSecret } from '../db.js';
import {
  sendNotification,
  formatLinearNotification,
  formatNotionNotification,
} from '../services/notifications.js';

const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET;

export const webhookRoutes = new Hono();

// ============================================================================
// Linear Webhook
// ============================================================================

function verifyLinearSignature(signature: string | undefined, rawBody: string): boolean {
  if (!signature || !LINEAR_WEBHOOK_SECRET) return false;

  const computedSignature = crypto
    .createHmac('sha256', LINEAR_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(computedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

// Find users who have a specific provider connected
async function findUsersWithProvider(provider: string): Promise<string[]> {
  if (!sql) return [];
  const rows = await sql`
    SELECT DISTINCT user_id FROM oauth_tokens WHERE provider = ${provider}
  `;
  return rows.map(r => r.user_id);
}

webhookRoutes.post('/linear', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('linear-signature');

  if (!verifyLinearSignature(signature, rawBody)) {
    console.error('Linear webhook: Invalid signature');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const payload = JSON.parse(rawBody);
  const { action, type, data, actor, webhookTimestamp } = payload;

  // Verify timestamp (within 60 seconds)
  if (Math.abs(Date.now() - webhookTimestamp) > 60 * 1000) {
    console.error('Linear webhook: Timestamp too old');
    return c.json({ error: 'Timestamp too old' }, 401);
  }

  console.log(`Linear webhook: ${action} ${type}`, { id: data?.id, actor: actor?.name });

  try {
    const notification = formatLinearNotification(action, type, data, actor);

    if (notification) {
      const userIds = await findUsersWithProvider('linear');
      for (const userId of userIds) {
        const result = await sendNotification(userId, notification);
        console.log(`Notification sent to ${userId}:`, result);
      }
    }

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error('Linear webhook error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================================================
// Notion Webhook
// ============================================================================

function verifyNotionSignature(
  signature: string | undefined,
  rawBody: string,
  verificationToken: string
): boolean {
  if (!signature || !verificationToken) return false;

  const computedSignature = `sha256=${crypto
    .createHmac('sha256', verificationToken)
    .update(rawBody)
    .digest('hex')}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

webhookRoutes.post('/notion', async (c) => {
  const rawBody = await c.req.text();
  const payload = JSON.parse(rawBody);

  // Handle verification token (initial setup)
  if (payload.verification_token) {
    console.log('Notion webhook verification token received');
    console.log('NOTION_VERIFICATION_TOKEN:', payload.verification_token);
    return c.json({ success: true }, 200);
  }

  const signature = c.req.header('x-notion-signature');

  // Find users with Notion and verify against their stored token
  const userIds = await findUsersWithProvider('notion');
  let verifiedUserId: string | null = null;

  for (const userId of userIds) {
    const token = await getWebhookSecret(userId, 'notion');
    if (token && verifyNotionSignature(signature, rawBody, token)) {
      verifiedUserId = userId;
      break;
    }
  }

  if (!verifiedUserId) {
    // Try with global secret as fallback
    const globalSecret = process.env.NOTION_WEBHOOK_SECRET;
    if (globalSecret && verifyNotionSignature(signature, rawBody, globalSecret)) {
      verifiedUserId = 'all';
    } else {
      console.error('Notion webhook: Invalid signature');
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  const eventType = payload.type;
  console.log(`Notion webhook: ${eventType}`, { entity: payload.entity?.id });

  try {
    const notification = formatNotionNotification(eventType, payload);

    if (notification) {
      if (verifiedUserId === 'all') {
        for (const userId of userIds) {
          const result = await sendNotification(userId, notification);
          console.log(`Notification sent to ${userId}:`, result);
        }
      } else {
        const result = await sendNotification(verifiedUserId, notification);
        console.log(`Notification sent to ${verifiedUserId}:`, result);
      }
    }

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error('Notion webhook error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});
