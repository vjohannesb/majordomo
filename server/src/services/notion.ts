/**
 * Notion Service
 */

import { Client } from '@notionhq/client';
import { getOAuthTokens } from '../db.js';

/**
 * Get Notion client for a user
 */
async function getNotionClient(userId: string, accountName?: string) {
  const tokens = await getOAuthTokens(userId, 'notion');

  if (tokens.length === 0) {
    throw new Error('No Notion account connected. Visit /dashboard to connect Notion.');
  }

  const token = accountName
    ? tokens.find(t => t.accountName.toLowerCase() === accountName.toLowerCase())
    : tokens[0];

  if (!token || !token.accessToken) {
    throw new Error(`Notion account "${accountName}" not found.`);
  }

  return {
    client: new Client({ auth: token.accessToken }),
    workspace: token.accountName,
  };
}

export async function searchNotion(
  userId: string,
  query: string,
  options: { limit?: number; account?: string } = {}
): Promise<string> {
  const { limit = 10, account } = options;
  const { client, workspace } = await getNotionClient(userId, account);

  const response = await client.search({
    query,
    page_size: limit,
  });

  if (response.results.length === 0) {
    return `No results found for "${query}" in ${workspace}.`;
  }

  const formatted = response.results.map((result: any, i: number) => {
    if (result.object === 'page') {
      const title = extractPageTitle(result);
      return `${i + 1}. [Page] ${title}\n   ID: ${result.id}`;
    } else if (result.object === 'database') {
      const title = result.title?.[0]?.plain_text || 'Untitled Database';
      return `${i + 1}. [Database] ${title}\n   ID: ${result.id}`;
    }
    return `${i + 1}. [${result.object}] ID: ${result.id}`;
  }).join('\n\n');

  return `Notion search results for "${query}" (${workspace}):\n\n${formatted}`;
}

export async function readNotionPage(
  userId: string,
  pageId: string,
  account?: string
): Promise<string> {
  const { client, workspace } = await getNotionClient(userId, account);

  const page = await client.pages.retrieve({ page_id: pageId }) as any;
  const title = extractPageTitle(page);

  const blocks = await client.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  const content = blocks.results.map(block => blockToText(block as any)).join('\n');

  return `# ${title}\n\nWorkspace: ${workspace}\nID: ${pageId}\nLast edited: ${page.last_edited_time}\n\n---\n\n${content}`;
}

export async function createNotionPage(
  userId: string,
  title: string,
  options: { parentId?: string; content?: string; account?: string } = {}
): Promise<string> {
  const { parentId, content, account } = options;
  const { client, workspace } = await getNotionClient(userId, account);

  if (!parentId) {
    throw new Error('parentId is required. Use notion_search to find a database or page ID.');
  }

  let page;
  try {
    page = await client.pages.create({
      parent: { database_id: parentId },
      properties: {
        Name: { title: [{ text: { content: title } }] },
      },
      children: content ? parseContentToBlocks(content) : [],
    });
  } catch {
    page = await client.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
      children: content ? parseContentToBlocks(content) : [],
    });
  }

  return `Page created in ${workspace}:\nTitle: ${title}\nID: ${page.id}\nURL: ${(page as any).url}`;
}

export async function listNotionDatabases(
  userId: string,
  account?: string
): Promise<string> {
  const { client, workspace } = await getNotionClient(userId, account);

  const response = await client.search({
    filter: { property: 'object', value: 'database' } as any,
    page_size: 20,
  });

  if (response.results.length === 0) {
    return `No databases found in ${workspace}.`;
  }

  const formatted = response.results.map((db: any, i: number) => {
    const title = db.title?.[0]?.plain_text || 'Untitled Database';
    return `${i + 1}. ${title}\n   ID: ${db.id}`;
  }).join('\n\n');

  return `Notion databases (${workspace}):\n\n${formatted}`;
}

export async function queryNotionDatabase(
  userId: string,
  databaseId: string,
  options: { limit?: number; account?: string } = {}
): Promise<string> {
  const { limit = 20, account } = options;
  const { client, workspace } = await getNotionClient(userId, account);

  const response = await (client as any).databases.query({
    database_id: databaseId,
    page_size: limit,
  });

  if (response.results.length === 0) {
    return `No items found in database.`;
  }

  const formatted = response.results.map((page: any, i: number) => {
    const title = extractPageTitle(page);
    return `${i + 1}. ${title}\n   ID: ${page.id}`;
  }).join('\n\n');

  return `Database items (${workspace}):\n\n${formatted}`;
}

// Helper functions

function extractPageTitle(page: any): string {
  const props = page.properties || {};

  for (const key of ['Name', 'Title', 'title', 'name']) {
    if (props[key]?.title?.[0]?.plain_text) {
      return props[key].title[0].plain_text;
    }
  }

  for (const prop of Object.values(props) as any[]) {
    if (prop?.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }

  return 'Untitled';
}

function blockToText(block: any): string {
  const type = block.type;
  const data = block[type];

  if (!data) return '';

  const text = data.rich_text?.map((t: any) => t.plain_text).join('') || '';

  switch (type) {
    case 'paragraph':
      return text;
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do':
      return `[${data.checked ? 'x' : ' '}] ${text}`;
    case 'toggle':
      return `> ${text}`;
    case 'code':
      return `\`\`\`${data.language || ''}\n${text}\n\`\`\``;
    case 'quote':
      return `> ${text}`;
    case 'divider':
      return '---';
    case 'callout':
      return `> ${text}`;
    default:
      return text;
  }
}

function parseContentToBlocks(content: string): any[] {
  return content.split('\n').map(line => {
    if (line.startsWith('# ')) {
      return {
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
      };
    } else if (line.startsWith('## ')) {
      return {
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] },
      };
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      return {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
      };
    } else {
      return {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
      };
    }
  });
}
