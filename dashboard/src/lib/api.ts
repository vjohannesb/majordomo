/**
 * API Client for Majordomo Server
 */

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';

export interface User {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface ServiceAccount {
  name: string;
  email?: string;
}

export interface Service {
  id: string;
  name: string;
  icon: string;
  description: string;
  authType: 'oauth' | 'apikey';
  authUrl: string;
  connected: boolean;
  accounts: ServiceAccount[];
}

export interface Settings {
  notificationChannel: 'slack' | 'email' | 'none';
  slackChannelId?: string;
}

export interface McpConfig {
  sseUrl: string;
  apiKey: string;
  configs: {
    claudeDesktop: {
      url: string;
      note: string;
    };
    claudeCode: {
      mcpServers: {
        majordomo: {
          url: string;
          headers: {
            Authorization: string;
          };
        };
      };
    };
    install: {
      cursor: string;
      vscode: string;
      vscodeInsiders: string;
    };
  };
  webhooks: {
    linear: string;
    notion: string;
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = SERVER_URL) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      credentials: 'include', // Include cookies for auth
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Not authenticated');
      }
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // User
  async getMe(): Promise<User> {
    return this.fetch<User>('/api/me');
  }

  // Services
  async getServices(): Promise<{ services: Service[] }> {
    return this.fetch<{ services: Service[] }>('/api/services');
  }

  async getService(id: string): Promise<{ service: Service }> {
    return this.fetch<{ service: Service }>(`/api/services/${id}`);
  }

  async disconnectService(serviceId: string, accountName: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(
      `/api/services/${serviceId}/${encodeURIComponent(accountName)}`,
      { method: 'DELETE' }
    );
  }

  // Settings
  async getSettings(): Promise<Settings> {
    return this.fetch<Settings>('/api/settings');
  }

  async updateSettings(settings: Partial<Settings>): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // MCP Config
  async getMcpConfig(): Promise<McpConfig> {
    return this.fetch<McpConfig>('/api/mcp-config');
  }

  // Auth URLs (for redirects)
  getAuthUrl(service: string): string {
    return `${this.baseUrl}/auth/${service}`;
  }

  getLogoutUrl(): string {
    return `${this.baseUrl}/auth/logout`;
  }
}

export const api = new ApiClient();
export { SERVER_URL };
