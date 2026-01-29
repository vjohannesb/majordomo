/**
 * Gateway Server
 *
 * HTTP/WebSocket server for accessing Majordomo.
 * Provides REST API and real-time streaming support.
 *
 * This is the foundation for:
 * - Web interface
 * - Mobile apps
 * - Third-party integrations
 * - Webhooks from services
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AgentRunner, SessionManager, type AgentResponse } from '../agent/index.js';
import { EventEmitter } from 'node:events';

export interface GatewayConfig {
  port: number;
  host?: string;
  corsOrigins?: string[];
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  stream?: boolean;
}

export interface ChatResponse {
  text: string;
  sessionId: string;
  toolsUsed: string[];
}

// Simple event bus for real-time updates
export const gatewayEvents = new EventEmitter();

export class GatewayServer {
  private server: ReturnType<typeof createServer>;
  private sessionManager: SessionManager;
  private config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.sessionManager = new SessionManager();
    this.server = createServer(this.handleRequest.bind(this));
  }

  private cors(res: ServerResponse) {
    const origins = this.config.corsOrigins || ['*'];
    res.setHeader('Access-Control-Allow-Origin', origins.join(','));
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private json(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private async parseBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    this.cors(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    try {
      // Health check
      if (url.pathname === '/health' && req.method === 'GET') {
        this.json(res, { status: 'ok', version: '0.1.0' });
        return;
      }

      // Chat endpoint
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        await this.handleChat(req, res);
        return;
      }

      // Chat with streaming (Server-Sent Events)
      if (url.pathname === '/api/chat/stream' && req.method === 'POST') {
        await this.handleChatStream(req, res);
        return;
      }

      // List sessions
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        const sessions = this.sessionManager.listSessions();
        this.json(res, { sessions });
        return;
      }

      // Get session
      if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
        const sessionId = url.pathname.split('/')[3];
        if (sessionId) {
          const session = this.sessionManager.getSession(sessionId);
          this.json(res, { session });
        } else {
          this.json(res, { error: 'Session ID required' }, 400);
        }
        return;
      }

      // 404
      this.json(res, { error: 'Not found' }, 404);
    } catch (err) {
      console.error('Gateway error:', err);
      this.json(res, { error: err instanceof Error ? err.message : 'Internal error' }, 500);
    }
  }

  private async handleChat(req: IncomingMessage, res: ServerResponse) {
    const body = await this.parseBody<ChatRequest>(req);

    if (!body.message) {
      this.json(res, { error: 'Message is required' }, 400);
      return;
    }

    const agent = new AgentRunner();
    const result = await agent.run(body.message, {
      sessionId: body.sessionId,
      stream: false,
    });

    const response: ChatResponse = {
      text: result.text,
      sessionId: result.sessionId,
      toolsUsed: result.toolsUsed,
    };

    this.json(res, response);
  }

  private async handleChatStream(req: IncomingMessage, res: ServerResponse) {
    const body = await this.parseBody<ChatRequest>(req);

    if (!body.message) {
      this.json(res, { error: 'Message is required' }, 400);
      return;
    }

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const agent = new AgentRunner();

    // Stream events to client
    agent.on('text', (chunk) => {
      sendEvent('text', { chunk });
    });

    agent.on('tool:start', (name, input) => {
      sendEvent('tool:start', { name, input });
    });

    agent.on('tool:done', (name, result) => {
      sendEvent('tool:done', { name, result: result.slice(0, 500) }); // Truncate long results
    });

    agent.on('error', (err) => {
      sendEvent('error', { message: err.message });
    });

    try {
      const result = await agent.run(body.message, {
        sessionId: body.sessionId,
        stream: true,
      });

      sendEvent('done', {
        text: result.text,
        sessionId: result.sessionId,
        toolsUsed: result.toolsUsed,
      });
    } catch (err) {
      sendEvent('error', { message: err instanceof Error ? err.message : 'Unknown error' });
    }

    res.end();
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host || '0.0.0.0', () => {
        console.log(`Gateway server running on http://${this.config.host || '0.0.0.0'}:${this.config.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

// CLI entrypoint for running the gateway
export async function startGateway(port = 3000) {
  const server = new GatewayServer({ port });
  await server.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gateway...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}
