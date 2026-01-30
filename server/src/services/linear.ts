/**
 * Linear Service
 */

import { LinearClient } from '@linear/sdk';
import { getOAuthTokens } from '../db.js';

/**
 * Get Linear client for a user
 */
async function getLinearClient(userId: string, accountName?: string) {
  const tokens = await getOAuthTokens(userId, 'linear');

  if (tokens.length === 0) {
    throw new Error('No Linear account connected. Visit /dashboard to connect Linear.');
  }

  const token = accountName
    ? tokens.find(t => t.accountName.toLowerCase() === accountName.toLowerCase())
    : tokens[0];

  if (!token || !token.accessToken) {
    throw new Error(`Linear account "${accountName}" not found.`);
  }

  return {
    client: new LinearClient({ apiKey: token.accessToken }),
    workspace: token.accountName,
  };
}

export async function listIssues(
  userId: string,
  options: { query?: string; limit?: number; account?: string } = {}
): Promise<string> {
  const { query, limit = 20, account } = options;
  const { client, workspace } = await getLinearClient(userId, account);

  const issues = query
    ? await client.issueSearch({ query, first: limit })
    : await client.issues({ first: limit, orderBy: 'updatedAt' as any });

  const nodes = issues.nodes;

  if (nodes.length === 0) {
    return query ? `No issues found matching "${query}".` : 'No issues found.';
  }

  const formatted = await Promise.all(
    nodes.map(async (issue, i) => {
      const state = await issue.state;
      const assignee = await issue.assignee;
      return `${i + 1}. [${issue.identifier}] ${issue.title}
   Status: ${state?.name || 'Unknown'} | Assignee: ${assignee?.name || 'Unassigned'}
   Priority: ${issue.priority || 'None'}`;
    })
  );

  return `Linear issues (${workspace}):\n\n${formatted.join('\n\n')}`;
}

export async function createIssue(
  userId: string,
  title: string,
  options: { description?: string; teamId?: string; priority?: number; account?: string } = {}
): Promise<string> {
  const { description, teamId, priority, account } = options;
  const { client, workspace } = await getLinearClient(userId, account);

  let team = teamId;
  if (!team) {
    const teams = await client.teams();
    if (teams.nodes.length === 0) {
      throw new Error('No teams found in Linear workspace.');
    }
    team = teams.nodes[0]!.id;
  }

  const issue = await client.createIssue({
    title,
    description,
    teamId: team,
    priority,
  });

  const created = await issue.issue;
  if (!created) {
    throw new Error('Failed to create issue.');
  }

  return `Issue created in ${workspace}:
[${created.identifier}] ${created.title}
URL: ${created.url}`;
}

export async function updateIssue(
  userId: string,
  issueId: string,
  updates: { title?: string; description?: string; stateId?: string; assigneeId?: string; priority?: number; account?: string }
): Promise<string> {
  const { account, ...updateData } = updates;
  const { client, workspace } = await getLinearClient(userId, account);

  const issues = await client.issueSearch({ query: issueId, first: 1 });
  const issue = issues.nodes[0];

  if (!issue) {
    throw new Error(`Issue "${issueId}" not found.`);
  }

  await client.updateIssue(issue.id, updateData);

  return `Issue ${issueId} updated in ${workspace}.`;
}
