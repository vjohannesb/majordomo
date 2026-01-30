"use client";

import { Mail, MessageSquare, CheckSquare, FileText, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Service, api } from "@/lib/api";

const iconMap: Record<string, LucideIcon> = {
  mail: Mail,
  "message-square": MessageSquare,
  "check-square": CheckSquare,
  "file-text": FileText,
};

interface ServiceCardProps {
  service: Service;
  onDisconnect?: (serviceId: string, accountName: string) => void;
}

export function ServiceCard({ service, onDisconnect }: ServiceCardProps) {
  const Icon = iconMap[service.icon] || FileText;

  const handleConnect = () => {
    window.location.href = service.authUrl;
  };

  const handleDisconnect = (accountName: string) => {
    if (onDisconnect) {
      onDisconnect(service.id, accountName);
    }
  };

  return (
    <Card className={service.connected ? "border-l-4 border-l-green-500" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--secondary)]">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{service.name}</CardTitle>
              <CardDescription>{service.description}</CardDescription>
            </div>
          </div>
          <Badge variant={service.connected ? "success" : "secondary"}>
            {service.connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {service.connected && service.accounts.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {service.accounts.map((account) => (
              <Badge key={account.name} variant="outline" className="gap-1">
                {account.email || account.name}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {service.connected ? (
            <>
              <Button variant="secondary" size="sm" onClick={handleConnect}>
                Add Account
              </Button>
              {service.accounts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[var(--destructive)] hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => handleDisconnect(service.accounts[0]!.name)}
                >
                  Disconnect
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" onClick={handleConnect}>
              Connect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
