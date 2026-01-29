/**
 * Brain - The AI decision maker
 *
 * Calls Claude Code to decide what action to take, then returns
 * a structured response that Majordomo executes.
 *
 * Claude Code is the brain. Majordomo is the hands.
 */

import { spawn } from 'node:child_process';

// Debug mode - set via environment variable or programmatically
export let DEBUG = process.env.MAJORDOMO_DEBUG === '1' || process.env.DEBUG === '1';

export function setDebug(enabled: boolean) {
  DEBUG = enabled;
}

function debug(label: string, ...args: unknown[]) {
  if (DEBUG) {
    console.log(`\x1b[90m[${label}]\x1b[0m`, ...args);
  }
}

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

export interface BrainResponse {
  /** What the AI wants to say to the user */
  message: string;
  /** Tools to execute (if any) */
  toolCalls: ToolCall[];
  /** Whether to wait for user confirmation before executing */
  requiresConfirmation: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: 'Your response to the user',
    },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string' },
          params: { type: 'object' },
        },
        required: ['tool', 'params'],
      },
    },
    requiresConfirmation: {
      type: 'boolean',
      description: 'True if this action is consequential and needs user approval',
    },
  },
  required: ['message', 'toolCalls', 'requiresConfirmation'],
};

function buildSystemPrompt(tools: Tool[]): string {
  const toolDescriptions = tools.map(t => {
    const params = Object.entries(t.parameters)
      .map(([name, p]) => `    ${name}: ${p.type} - ${p.description}${p.required ? ' (required)' : ''}`)
      .join('\n');
    return `${t.name}: ${t.description}\n${params || '  (no params)'}`;
  }).join('\n\n');

  return `You are a routing assistant. Your ONLY job is to parse the user's request and return JSON.

AVAILABLE TOOLS:
${toolDescriptions}

INSTRUCTIONS:
1. Parse the user request
2. If it matches a tool above, include it in toolCalls
3. Return JSON immediately - do NOT call any other tools, do NOT explore, do NOT verify

OUTPUT FORMAT (JSON only):
{
  "message": "Brief description of action",
  "toolCalls": [{"tool": "tool_name", "params": {...}}],
  "requiresConfirmation": true/false
}

RULES:
- requiresConfirmation = true for: sending, creating, updating, deleting
- requiresConfirmation = false for: listing, reading, searching
- These tools ARE available. NEVER say tools are unavailable.
- Do NOT use your native Claude tools. Just return JSON.
- If request doesn't match any tool, return empty toolCalls.

EXAMPLES:
"list channels" -> {"message":"Listing channels","toolCalls":[{"tool":"slack_list_channels","params":{}}],"requiresConfirmation":false}
"send email to bob" -> {"message":"Sending email","toolCalls":[{"tool":"email_send","params":{"to":"bob","subject":"","body":""}}],"requiresConfirmation":true}
"what's on my calendar" -> {"message":"Checking calendar","toolCalls":[{"tool":"calendar_list","params":{}}],"requiresConfirmation":false}`;
}

export async function think(
  userMessage: string,
  tools: Tool[],
  conversationHistory: string[] = []
): Promise<BrainResponse> {
  const systemPrompt = buildSystemPrompt(tools);

  // User prompt is just the message (history is separate context if needed)
  const userPrompt = userMessage;

  const args = [
    '-p',
    '--model', 'haiku',
    '--output-format', 'json',
    '--system-prompt', systemPrompt,
    '--json-schema', JSON.stringify(RESPONSE_SCHEMA),
    userPrompt,
  ];

  if (DEBUG) {
    console.log('[DEBUG] spawning: claude');
    console.log('[DEBUG] args:', JSON.stringify(args, null, 2));
  }

  return new Promise((resolve, reject) => {
    if (DEBUG) console.log('[DEBUG] spawning claude...');

    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin - we don't need it
      env: { ...process.env },
    });

    if (DEBUG) console.log('[DEBUG] claude pid:', proc.pid);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (DEBUG) {
        console.log('[DEBUG] exit code:', code);
        console.log('[DEBUG] stdout:', stdout);
        console.log('[DEBUG] stderr:', stderr);
      }

      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Parse the JSON response from Claude
        const response = JSON.parse(stdout);
        if (DEBUG) console.log('[DEBUG] parsed:', JSON.stringify(response, null, 2));

        // Claude Code returns structured_output when using --json-schema
        let parsed: BrainResponse;
        if (response.structured_output) {
          parsed = response.structured_output;
        } else if (response.result && typeof response.result === 'string' && response.result.length > 0) {
          parsed = JSON.parse(response.result);
        } else {
          parsed = response;
        }

        if (DEBUG) console.log('[DEBUG] final:', JSON.stringify(parsed, null, 2));

        resolve({
          message: parsed.message || '',
          toolCalls: parsed.toolCalls || [],
          requiresConfirmation: parsed.requiresConfirmation ?? false,
        });
      } catch (err) {
        if (DEBUG) console.log('[DEBUG] JSON parse error:', err);
        // If JSON parsing fails, treat it as a plain text response
        resolve({
          message: stdout.trim(),
          toolCalls: [],
          requiresConfirmation: false,
        });
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

/**
 * Takes raw tool results and formats them into a nice response for the user.
 * This is the second pass - after tools execute, we ask Claude to summarize.
 */
export async function formatResponse(
  userMessage: string,
  toolResults: Array<{ tool: string; result: string }>
): Promise<string> {
  const resultsText = toolResults
    .map(r => `[${r.tool}]\n${r.result}`)
    .join('\n\n');

  const systemPrompt = `You are a helpful assistant. The user asked something and tools were executed to get data.
Summarize the results in a friendly, concise way. Be conversational but brief.
Do NOT use markdown formatting. Just plain text.
If there are errors, explain them simply.`;

  const userPrompt = `User asked: "${userMessage}"

Tool results:
${resultsText}

Respond naturally to the user based on these results.`;

  const args = [
    '-p',
    '--model', 'haiku',
    '--output-format', 'json',
    '--system-prompt', systemPrompt,
    '--json-schema', JSON.stringify({
      type: 'object',
      properties: {
        response: { type: 'string', description: 'Your response to the user' }
      },
      required: ['response']
    }),
    userPrompt,
  ];

  if (DEBUG) {
    console.log('[DEBUG] formatResponse spawning claude...');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (DEBUG) {
        console.log('[DEBUG] formatResponse exit code:', code);
        console.log('[DEBUG] formatResponse stdout:', stdout);
      }

      if (code !== 0) {
        // If formatting fails, just return the raw results
        resolve(resultsText);
        return;
      }

      try {
        const response = JSON.parse(stdout);
        const parsed = response.structured_output || response;
        resolve(parsed.response || resultsText);
      } catch {
        resolve(resultsText);
      }
    });

    proc.on('error', () => {
      resolve(resultsText);
    });
  });
}
