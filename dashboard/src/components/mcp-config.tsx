"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type McpConfig } from "@/lib/api";

interface McpConfigProps {
  config: McpConfig;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {label && <span className="ml-1">{label}</span>}
    </Button>
  );
}

export function McpConfigSection({ config }: McpConfigProps) {
  const claudeCodeConfig = JSON.stringify(config.configs.claudeCode, null, 2);

  return (
    <div className="space-y-4">
      {/* One-Click Install */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Install</CardTitle>
          <CardDescription>
            Click to add Majordomo to your favorite editor
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <a href={config.configs.install.cursor}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Add to Cursor
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a href={config.configs.install.vscode}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Add to VS Code
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={config.configs.install.vscodeInsiders}>
                <ExternalLink className="mr-2 h-4 w-4" />
                VS Code Insiders
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Claude Desktop */}
      <Card>
        <CardHeader>
          <CardTitle>Claude Desktop</CardTitle>
          <CardDescription>
            Go to Settings → MCP → Add Server and enter this URL. Sign in with Google when prompted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-[var(--muted)] px-3 py-2 text-sm font-mono">
              {config.sseUrl}
            </code>
            <CopyButton text={config.sseUrl} />
          </div>
        </CardContent>
      </Card>

      {/* Claude Code / API Key */}
      <Card>
        <CardHeader>
          <CardTitle>Claude Code & Other Clients</CardTitle>
          <CardDescription>
            For clients that use API key authentication
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <pre className="overflow-x-auto rounded-lg bg-[var(--muted)] p-4 text-sm font-mono">
              {claudeCodeConfig}
            </pre>
            <div className="mt-2 flex justify-end">
              <CopyButton text={claudeCodeConfig} label="Copy Config" />
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border)]">
            <p className="text-sm text-[var(--muted-foreground)] mb-2">Your API Key:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-[var(--muted)] px-3 py-2 text-sm font-mono truncate">
                {config.apiKey}
              </code>
              <CopyButton text={config.apiKey} />
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mt-2">
              Keep this key secret. Use it to authenticate MCP requests.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Webhooks */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook URLs</CardTitle>
          <CardDescription>
            Configure these URLs in Linear and Notion to receive real-time updates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-[var(--muted-foreground)]">Linear Webhook URL</label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 rounded-lg bg-[var(--muted)] px-3 py-2 text-sm font-mono">
                {config.webhooks.linear}
              </code>
              <CopyButton text={config.webhooks.linear} />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--muted-foreground)]">Notion Webhook URL</label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 rounded-lg bg-[var(--muted)] px-3 py-2 text-sm font-mono">
                {config.webhooks.notion}
              </code>
              <CopyButton text={config.webhooks.notion} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
