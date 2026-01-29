/**
 * Google Services (Gmail + Calendar)
 */

import { google } from 'googleapis';
import { getOAuthTokens, saveOAuthToken } from '../db.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

/**
 * Get authenticated Google client for a user
 */
async function getGoogleClient(userId: string, accountEmail?: string) {
  const tokens = await getOAuthTokens(userId, 'google');

  if (tokens.length === 0) {
    throw new Error('No Google account connected. Visit /dashboard to connect your account.');
  }

  // Find the right account
  const token = accountEmail
    ? tokens.find(t => t.accountName.toLowerCase() === accountEmail.toLowerCase())
    : tokens[0]; // Default to first account

  if (!token) {
    throw new Error(`Google account "${accountEmail}" not found. Connected accounts: ${tokens.map(t => t.accountName).join(', ')}`);
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
  });

  // Handle token refresh
  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      await saveOAuthToken(userId, {
        provider: 'google',
        accountName: token.accountName,
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || token.refreshToken,
        tokenData: { email: token.accountName },
      });
    }
  });

  return { client: oauth2Client, email: token.accountName };
}

// ============================================================================
// Gmail
// ============================================================================

export async function listEmails(
  userId: string,
  options: { maxResults?: number; account?: string } = {}
): Promise<string> {
  const { maxResults = 10, account } = options;
  const { client, email } = await getGoogleClient(userId, account);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    labelIds: ['INBOX'],
  });

  if (!response.data.messages || response.data.messages.length === 0) {
    return `No emails found in ${email} inbox.`;
  }

  const emails = await Promise.all(
    response.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      return { id: msg.id, from, subject, date, snippet: detail.data.snippet };
    })
  );

  const formatted = emails
    .map((e, i) => `${i + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   ${e.snippet?.slice(0, 100)}...\n   [ID: ${e.id}]`)
    .join('\n\n');

  return `Recent emails from ${email}:\n\n${formatted}`;
}

export async function readEmail(
  userId: string,
  emailId: string,
  account?: string
): Promise<string> {
  const { client, email } = await getGoogleClient(userId, account);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: emailId,
    format: 'full',
  });

  const headers = response.data.payload?.headers || [];
  const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
  const to = headers.find(h => h.name === 'To')?.value || '';
  const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
  const date = headers.find(h => h.name === 'Date')?.value || '';

  // Extract body
  const body = extractEmailBody(response.data.payload);

  return `From: ${from}
To: ${to}
Date: ${date}
Subject: ${subject}
Account: ${email}

${body}`;
}

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

function extractEmailBody(payload: GmailPart | undefined): string {
  if (!payload) return '';

  // Direct body
  if (payload.body?.data) {
    if (payload.mimeType === 'text/plain' || !payload.mimeType) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
  }

  // Multipart - look for text/plain first
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    // Recurse into nested parts
    for (const part of payload.parts) {
      const text = extractEmailBody(part);
      if (text) return text;
    }
  }

  return '(Could not extract email body)';
}

export async function searchEmails(
  userId: string,
  query: string,
  options: { limit?: number; account?: string } = {}
): Promise<string> {
  const { limit = 10, account } = options;
  const { client, email } = await getGoogleClient(userId, account);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: limit,
  });

  if (!response.data.messages || response.data.messages.length === 0) {
    return `No emails found matching "${query}" in ${email}.`;
  }

  const emails = await Promise.all(
    response.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';

      return { id: msg.id, from, subject, snippet: detail.data.snippet };
    })
  );

  const formatted = emails
    .map((e, i) => `${i + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   ${e.snippet?.slice(0, 100)}...\n   [ID: ${e.id}]`)
    .join('\n\n');

  return `Search results for "${query}" in ${email}:\n\n${formatted}`;
}

export async function sendEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  account?: string
): Promise<string> {
  const { client, email } = await getGoogleClient(userId, account);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const message = [
    `From: ${email}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    body,
  ].join('\n');

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });

  return `Email sent from ${email} to ${to}. Message ID: ${response.data.id}`;
}

// ============================================================================
// Calendar
// ============================================================================

export async function listCalendarEvents(
  userId: string,
  options: { days?: number; limit?: number; account?: string } = {}
): Promise<string> {
  const { days = 7, limit = 20, account } = options;
  const { client, email } = await getGoogleClient(userId, account);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    maxResults: limit,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items || [];

  if (events.length === 0) {
    return `No upcoming events in the next ${days} days for ${email}.`;
  }

  const formatted = events.map((event, i) => {
    const start = event.start?.dateTime || event.start?.date || 'TBD';
    const end = event.end?.dateTime || event.end?.date || '';
    const location = event.location ? `\n   Location: ${event.location}` : '';
    const description = event.description ? `\n   ${event.description.slice(0, 100)}...` : '';

    return `${i + 1}. ${event.summary || '(no title)'}\n   ${formatDateTime(start)} - ${formatDateTime(end)}${location}${description}\n   [ID: ${event.id}]`;
  }).join('\n\n');

  return `Upcoming events for ${email} (next ${days} days):\n\n${formatted}`;
}

export async function createCalendarEvent(
  userId: string,
  title: string,
  start: string,
  end: string,
  options: { description?: string; location?: string; account?: string } = {}
): Promise<string> {
  const { description, location, account } = options;
  const { client, email } = await getGoogleClient(userId, account);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const event = {
    summary: title,
    description,
    location,
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
  });

  return `Event created on ${email} calendar:
Title: ${response.data.summary}
When: ${formatDateTime(start)} - ${formatDateTime(end)}
${location ? `Location: ${location}\n` : ''}Event ID: ${response.data.id}
Link: ${response.data.htmlLink}`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
