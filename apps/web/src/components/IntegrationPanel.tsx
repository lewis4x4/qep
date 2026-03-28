/**
 * IntegrationPanel — right-side drawer (desktop) / full-screen sheet (mobile).
 * Contains: connection status, credential form, sync scope toggles, audit log.
 * Per blueprint §6.2 and CDO design direction §1 (Drawer pattern).
 */

import { useState } from "react";
import { X, CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DataSourceBadge, type DataSourceState } from "./DataSourceBadge";
import { cn } from "@/lib/utils";
import type { IntegrationCardConfig } from "./IntegrationHub";
import { supabase } from "@/lib/supabase";

interface IntegrationPanelProps {
  integration: IntegrationCardConfig | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
}

function statusToDataSource(status: IntegrationCardConfig["status"]): DataSourceState {
  switch (status) {
    case "connected": return "Live";
    case "demo_mode": return "Demo";
    case "pending_credentials": return "Manual";
    case "error": return "Error";
    default: return "Manual";
  }
}

export function IntegrationPanel({ integration, open, onClose, onSaved }: IntegrationPanelProps) {
  const [credentials, setCredentials] = useState("");
  const [endpointUrl, setEndpointUrl] = useState(integration?.endpointUrl ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!integration) return null;

  async function handleSave() {
    if (!integration) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const { error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "update_integration",
          integration_key: integration.key,
          credentials,
          endpoint_url: endpointUrl || null,
        },
      });
      if (error) throw new Error(error.message);
      setCredentials("");
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTest() {
    if (!integration) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "test_integration",
          integration_key: integration.key,
        },
      });
      if (error) throw new Error(error.message);
      setTestResult(data as TestResult);
    } catch (err) {
      setTestResult({
        success: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setIsTesting(false);
    }
  }

  const dataSourceState = statusToDataSource(integration.status);

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[520px] flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-5 border-b border-[#E2E8F0] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center text-lg font-bold text-[#1B2A3D] shrink-0">
              {integration.icon}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-[15px] font-semibold text-[#1B2A3D] leading-5">
                {integration.name}
              </SheetTitle>
              <SheetDescription className="text-xs text-[#64748B] mt-0.5">
                {integration.category}
              </SheetDescription>
            </div>
            <DataSourceBadge state={dataSourceState} />
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Section 1: Connection status */}
          <section>
            <h4 className="text-sm font-semibold text-[#1B2A3D] mb-3">Connection Status</h4>
            <div
              className={cn(
                "rounded-lg border p-4 flex items-start gap-3",
                integration.status === "connected"
                  ? "bg-[#F0FDF4] border-[#BBF7D0]"
                  : integration.status === "error"
                  ? "bg-[#FEF2F2] border-[#FECACA]"
                  : "bg-[#F8FAFC] border-[#E2E8F0]"
              )}
            >
              {integration.status === "connected" ? (
                <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
              ) : integration.status === "error" ? (
                <XCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1B2A3D]">
                  {integration.status === "connected"
                    ? "Connected and syncing"
                    : integration.status === "error"
                    ? "Connection error"
                    : integration.status === "demo_mode"
                    ? "Running in demo mode"
                    : "Credentials required"}
                </p>
                {integration.lastSyncError && (
                  <p className="text-xs text-[#DC2626] mt-1 break-words">{integration.lastSyncError}</p>
                )}
                {integration.status === "pending_credentials" && (
                  <p className="text-xs text-[#64748B] mt-1">
                    Add credentials below to connect this integration. The system will operate in demo mode until connected.
                  </p>
                )}
              </div>
            </div>
          </section>

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 2: Credential form */}
          <section>
            <h4 className="text-sm font-semibold text-[#1B2A3D] mb-3">Credentials &amp; Configuration</h4>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="credentials" className="text-xs font-medium text-[#374151]">
                  API Key / Token
                  <span className="text-[#94A3B8] ml-1">(encrypted at rest)</span>
                </Label>
                <Input
                  id="credentials"
                  type="password"
                  placeholder={
                    integration.status === "connected"
                      ? "Leave blank to keep current credentials"
                      : "Enter API key or bearer token"
                  }
                  value={credentials}
                  onChange={(e) => setCredentials(e.target.value)}
                  className="font-mono text-sm focus-visible:ring-[#E87722]"
                  autoComplete="off"
                />
                <p className="text-xs text-[#94A3B8]">
                  Stored with AES-256-GCM encryption. Never logged or exposed in plaintext.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endpoint-url" className="text-xs font-medium text-[#374151]">
                  Endpoint URL
                  <span className="text-[#94A3B8] ml-1">(optional)</span>
                </Label>
                <Input
                  id="endpoint-url"
                  type="url"
                  placeholder="https://api.vendor.com"
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  className="text-sm focus-visible:ring-[#E87722]"
                />
              </div>
            </div>
            {saveError && (
              <p className="text-xs text-[#DC2626] mt-2">{saveError}</p>
            )}
          </section>

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 3: Connection test */}
          <section>
            <h4 className="text-sm font-semibold text-[#1B2A3D] mb-3">Connection Test</h4>
            <Button
              variant="outline"
              size="sm"
              className="border-[#E2E8F0] text-[#1B2A3D] hover:bg-[#F8FAFC] focus-visible:ring-[#E87722] w-full"
              onClick={() => void handleTest()}
              disabled={isTesting}
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
                  Testing connection…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                  Test connection
                </>
              )}
            </Button>
            {testResult !== null && (
              <div
                className={cn(
                  "mt-3 rounded-lg border p-3 flex items-start gap-2",
                  testResult.success
                    ? "bg-[#F0FDF4] border-[#BBF7D0]"
                    : "bg-[#FEF2F2] border-[#FECACA]"
                )}
                role="status"
                aria-live="polite"
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <XCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div>
                  <p className="text-sm font-medium text-[#1B2A3D]">
                    {testResult.success ? "Connection successful" : "Connection failed"}
                  </p>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    {testResult.success
                      ? `Response in ${testResult.latencyMs}ms`
                      : testResult.error}
                  </p>
                </div>
              </div>
            )}
          </section>

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 4: Fallback / demo mode explanation */}
          <section>
            <h4 className="text-sm font-semibold text-[#1B2A3D] mb-2">Demo Mode</h4>
            <p className="text-sm text-[#64748B] leading-relaxed">
              While disconnected, the system uses realistic synthetic data from the{" "}
              <strong className="text-[#1B2A3D]">{integration.name}</strong> mock adapter.
              All Deal Genome Engine features remain fully operational. Data source badges
              will show <span className="font-medium text-[#E87722]">Demo</span> to distinguish
              live from synthetic data.
            </p>
          </section>
        </div>

        {/* Pinned footer action */}
        <div className="shrink-0 px-6 py-4 border-t border-[#E2E8F0] bg-white">
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-[#E2E8F0] text-[#1B2A3D] focus-visible:ring-[#E87722]"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-[#E87722] hover:bg-[#D06A1B] text-white focus-visible:ring-[#E87722]"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Save configuration"
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
