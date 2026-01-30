"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServiceCard } from "@/components/service-card";
import { McpConfigSection } from "@/components/mcp-config";
import { NotificationSettings } from "@/components/notification-settings";
import { api, type User, type Service, type Settings, type McpConfig, SERVER_URL } from "@/lib/api";

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [userData, servicesData, settingsData, mcpData] = await Promise.all([
        api.getMe(),
        api.getServices(),
        api.getSettings(),
        api.getMcpConfig(),
      ]);
      setUser(userData);
      setServices(servicesData.services);
      setSettings(settingsData);
      setMcpConfig(mcpData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      if (message === 'Not authenticated') {
        window.location.href = `${SERVER_URL}/auth/google`;
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDisconnect = async (serviceId: string, accountName: string) => {
    try {
      await api.disconnectService(serviceId, accountName);
      fetchData();
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  const handleSaveSettings = async (newSettings: Partial<Settings>) => {
    await api.updateSettings(newSettings);
    const updated = await api.getSettings();
    setSettings(updated);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
        <p className="text-[var(--destructive)]">{error}</p>
        <Button onClick={fetchData}>Try Again</Button>
      </div>
    );
  }

  const connectedCount = services.filter(s => s.connected).length;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Majordomo</h1>
          </div>
          <div className="flex items-center gap-4">
            {user?.picture && (
              <Image
                src={user.picture}
                alt=""
                width={32}
                height={32}
                className="rounded-full"
              />
            )}
            <span className="text-sm text-[var(--muted-foreground)]">
              {user?.name || user?.email}
            </span>
            <Button variant="ghost" size="sm" asChild>
              <a href={api.getLogoutUrl()}>
                <LogOut className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl p-4 space-y-8">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
                Connected Services
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{connectedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
                Available Tools
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{connectedCount * 3}+</p>
            </CardContent>
          </Card>
        </div>

        {/* Services */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Connected Services</h2>
          <div className="grid gap-4">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>
        </section>

        {/* Notifications */}
        {settings && (
          <section>
            <h2 className="text-lg font-semibold mb-4">Settings</h2>
            <NotificationSettings
              settings={settings}
              services={services}
              onSave={handleSaveSettings}
            />
          </section>
        )}

        {/* MCP Config */}
        {mcpConfig && (
          <section>
            <h2 className="text-lg font-semibold mb-4">MCP Configuration</h2>
            <McpConfigSection config={mcpConfig} />
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] mt-12">
        <div className="mx-auto max-w-5xl p-4 text-center text-sm text-[var(--muted-foreground)]">
          <a href="/" className="hover:underline">Home</a>
          {" · "}
          <a href={`${SERVER_URL}/mcp/tools`} className="hover:underline">View Tools</a>
        </div>
      </footer>
    </div>
  );
}
