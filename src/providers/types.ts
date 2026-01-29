/**
 * Provider Types
 *
 * Defines the available AI providers and their authentication methods.
 */

export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'claude-code';

export type AuthMode = 'api_key' | 'oauth' | 'cli';

export interface ProviderConfig {
  provider: ProviderType;
  authMode: AuthMode;
  model?: string;

  // API key auth
  apiKey?: string;

  // OAuth auth (for future use)
  accessToken?: string;
  refreshToken?: string;

  // Ollama specific
  baseUrl?: string;

  // Claude Code specific (uses system's claude CLI)
  // No additional config needed - uses whatever claude is configured with
}

export interface ProviderInfo {
  id: ProviderType;
  name: string;
  description: string;
  authModes: Array<{
    mode: AuthMode;
    name: string;
    description: string;
  }>;
  defaultModel: string;
  models: string[];
}

export const PROVIDERS: Record<ProviderType, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models via Anthropic API',
    authModes: [
      { mode: 'api_key', name: 'API Key', description: 'Use your Anthropic API key (pay per use)' },
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-3-20240307',
    ],
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models via OpenAI API',
    authModes: [
      { mode: 'api_key', name: 'API Key', description: 'Use your OpenAI API key (pay per use)' },
    ],
    defaultModel: 'gpt-4o',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1',
      'o1-mini',
    ],
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Run models locally with Ollama - no API key needed',
    authModes: [
      { mode: 'cli', name: 'Local', description: 'Connect to local Ollama server (free, runs on your machine)' },
    ],
    defaultModel: 'llama3.2',
    models: [
      'llama3.2',
      'llama3.1',
      'mistral',
      'mixtral',
      'codellama',
      'qwen2.5-coder',
    ],
  },

  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code CLI',
    description: 'Use your existing Claude Code setup (works with Claude Max subscription)',
    authModes: [
      { mode: 'cli', name: 'Claude CLI', description: 'Uses your existing Claude Code authentication' },
    ],
    defaultModel: 'default', // Uses whatever claude is configured with
    models: ['default'],
  },
};

export const DEFAULT_PROVIDER: ProviderType = 'anthropic';
