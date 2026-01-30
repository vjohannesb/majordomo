"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { type Settings, type Service, api } from "@/lib/api";

interface NotificationSettingsProps {
  settings: Settings;
  services: Service[];
  onSave: (settings: Partial<Settings>) => Promise<void>;
}

export function NotificationSettings({ settings, services, onSave }: NotificationSettingsProps) {
  const [channel, setChannel] = useState(settings.notificationChannel);
  const [saving, setSaving] = useState(false);

  const hasSlack = services.some(s => s.id === 'slack' && s.connected);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ notificationChannel: channel });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Get notified when things happen in Linear, Notion, and other services
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Notification Channel
          </label>
          <Select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Settings['notificationChannel'])}
          >
            <option value="none">Disabled</option>
            <option value="slack" disabled={!hasSlack}>
              Slack {!hasSlack ? '(connect Slack first)' : ''}
            </option>
            <option value="email">Email (via Gmail)</option>
          </Select>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </CardContent>
    </Card>
  );
}
