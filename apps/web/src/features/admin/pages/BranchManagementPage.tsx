import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RequireAdmin } from "@/components/RequireAdmin";
import { Building2, MapPin, Phone, Mail, Users, Clock, FileText, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Shield, LocateFixed, Loader2 } from "lucide-react";
import { BranchLogoUpload } from "@/components/BranchLogoUpload";
import { geocodeAddress } from "@/lib/geocode";
import {
  useBranches,
  useSaveBranch,
  useDeleteBranch,
  type Branch,
  type BranchUpsertPayload,
} from "@/hooks/useBranches";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";

const DOW_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAPABILITIES = [
  "parts_counter",
  "service_bay",
  "rental_yard",
  "sales_showroom",
  "warehouse",
  "mobile_service",
  "body_shop",
  "paint_booth",
] as const;

const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

interface TeamMember {
  id: string;
  full_name: string;
  role: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toTeamMember(value: unknown): TeamMember | null {
  if (!isRecord(value)) return null;
  const profile = Array.isArray(value.profiles) ? value.profiles.find(isRecord) : value.profiles;
  const profileRecord = isRecord(profile) ? profile : null;
  const id = stringValue(profileRecord?.id, stringValue(value.profile_id));
  if (!id) return null;
  return {
    id,
    full_name: stringValue(profileRecord?.full_name, "Unknown"),
    role: stringValue(value.role, "member"),
  };
}

function useWorkspaceMembers() {
  const wsQ = useMyWorkspaceId();
  const ws = wsQ.data;

  return useQuery<TeamMember[]>({
    queryKey: ["workspace-members", ws],
    enabled: !!ws,
    staleTime: 120_000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("profile_workspaces")
          .select("profile_id, role, profiles!profile_workspaces_profile_id_fkey(id, full_name)")
          .eq("workspace_id", ws!);
        if (error) throw error;
        return (data ?? [])
          .flatMap((row) => {
            const member = toTeamMember(row);
            return member ? [member] : [];
          })
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
      } catch {
        return [];
      }
    },
  });
}

function PersonPicker({
  label,
  value,
  onChange,
  members,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  members: TeamMember[];
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground block mb-0.5">{label}</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full h-8 rounded border px-2 text-sm bg-background"
      >
        <option value="">— None —</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name} ({m.role})
          </option>
        ))}
      </select>
    </div>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function EmptyBranch(): BranchUpsertPayload {
  return {
    slug: "",
    display_name: "",
    short_code: "",
    is_active: true,
    address_line1: "",
    address_line2: "",
    city: "",
    state_province: "",
    postal_code: "",
    country: "US",
    phone_main: "",
    phone_parts: "",
    phone_service: "",
    phone_sales: "",
    fax: "",
    email_main: "",
    email_parts: "",
    email_service: "",
    email_sales: "",
    website_url: "",
    general_manager_id: null,
    sales_manager_id: null,
    service_manager_id: null,
    parts_manager_id: null,
    business_hours: [
      { dow: 1, open: "07:30", close: "17:00" },
      { dow: 2, open: "07:30", close: "17:00" },
      { dow: 3, open: "07:30", close: "17:00" },
      { dow: 4, open: "07:30", close: "17:00" },
      { dow: 5, open: "07:30", close: "17:00" },
    ],
    logo_url: "",
    header_tagline: "",
    doc_footer_text: "",
    tax_id: "",
    default_tax_rate: 0,
    license_numbers: [],
    capabilities: ["parts_counter", "service_bay"],
    timezone: "America/Chicago",
    delivery_radius_miles: null,
    max_service_bays: null,
    rental_yard_capacity: null,
    parts_counter: true,
    notes: "",
    metadata: {},
  };
}

function fromBranch(b: Branch): BranchUpsertPayload & { id: string } {
  return {
    id: b.id,
    slug: b.slug,
    display_name: b.display_name,
    short_code: b.short_code ?? "",
    is_active: b.is_active,
    address_line1: b.address_line1 ?? "",
    address_line2: b.address_line2 ?? "",
    city: b.city ?? "",
    state_province: b.state_province ?? "",
    postal_code: b.postal_code ?? "",
    country: b.country,
    phone_main: b.phone_main ?? "",
    phone_parts: b.phone_parts ?? "",
    phone_service: b.phone_service ?? "",
    phone_sales: b.phone_sales ?? "",
    fax: b.fax ?? "",
    email_main: b.email_main ?? "",
    email_parts: b.email_parts ?? "",
    email_service: b.email_service ?? "",
    email_sales: b.email_sales ?? "",
    website_url: b.website_url ?? "",
    general_manager_id: b.general_manager_id,
    sales_manager_id: b.sales_manager_id,
    service_manager_id: b.service_manager_id,
    parts_manager_id: b.parts_manager_id,
    business_hours: b.business_hours ?? [],
    logo_url: b.logo_url ?? "",
    header_tagline: b.header_tagline ?? "",
    doc_footer_text: b.doc_footer_text ?? "",
    tax_id: b.tax_id ?? "",
    default_tax_rate: b.default_tax_rate ?? 0,
    license_numbers: b.license_numbers ?? [],
    capabilities: b.capabilities ?? [],
    timezone: b.timezone,
    delivery_radius_miles: b.delivery_radius_miles,
    max_service_bays: b.max_service_bays,
    rental_yard_capacity: b.rental_yard_capacity,
    parts_counter: b.parts_counter,
    notes: b.notes ?? "",
    metadata: b.metadata ?? {},
  };
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}

function Field({ label, value, onChange, placeholder, type = "text", className = "" }: FieldProps) {
  return (
    <div className={className}>
      <label className="text-[11px] text-muted-foreground block mb-0.5">{label}</label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
    </div>
  );
}

function Section({ icon: Icon, title, children, defaultOpen = true }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg">
      <button
        type="button"
        className="flex items-center gap-2 w-full p-3 text-sm font-medium hover:bg-muted/30"
        onClick={() => setOpen(!open)}
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

export function BranchManagementPage() {
  return (
    <RequireAdmin>
      <BranchManagementPageInner />
    </RequireAdmin>
  );
}

function BranchManagementPageInner() {
  const branchesQ = useBranches();
  const saveMut = useSaveBranch();
  const deleteMut = useDeleteBranch();
  const membersQ = useWorkspaceMembers();
  const branches = branchesQ.data ?? [];
  const members = membersQ.data ?? [];

  const [editing, setEditing] = useState<(BranchUpsertPayload & { id?: string }) | null>(null);

  const set = <K extends keyof BranchUpsertPayload>(key: K, val: BranchUpsertPayload[K]) => {
    setEditing((prev) => prev ? { ...prev, [key]: val } : prev);
  };

  const startNew = () => setEditing(EmptyBranch());
  const startEdit = (b: Branch) => setEditing(fromBranch(b));
  const cancel = () => setEditing(null);

  const save = () => {
    if (!editing) return;
    const payload = {
      ...editing,
      slug: editing.slug || slugify(editing.display_name),
    };
    saveMut.mutate(payload, {
      onSuccess: () => setEditing(null),
    });
  };

  const hours = useMemo(() => {
    if (!editing) return [];
    return editing.business_hours ?? [];
  }, [editing]);

  const setHour = (idx: number, key: "open" | "close", val: string) => {
    const arr = [...hours];
    arr[idx] = { ...arr[idx], [key]: val };
    set("business_hours", arr);
  };

  const toggleDow = (dow: number) => {
    const exists = hours.find((h) => h.dow === dow);
    if (exists) {
      set("business_hours", hours.filter((h) => h.dow !== dow));
    } else {
      set("business_hours", [...hours, { dow, open: "07:30", close: "17:00" }].sort((a, b) => a.dow - b.dow));
    }
  };

  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const runGeocode = async () => {
    if (!editing) return;
    setGeocoding(true);
    setGeoError(null);
    try {
      const result = await geocodeAddress({
        address_line1: editing.address_line1 ?? "",
        city: editing.city ?? "",
        state_province: editing.state_province ?? "",
        postal_code: editing.postal_code ?? "",
        country: editing.country ?? "US",
      });
      if (result) {
        set("latitude", Math.round(result.lat * 10_000_000) / 10_000_000);
        set("longitude", Math.round(result.lon * 10_000_000) / 10_000_000);
      } else {
        setGeoError("No results found — try a more specific address");
      }
    } catch {
      setGeoError("Geocoding service unavailable");
    } finally {
      setGeocoding(false);
    }
  };

  const caps = editing?.capabilities ?? [];
  const toggleCap = (c: string) => {
    set("capabilities", caps.includes(c) ? caps.filter((x) => x !== c) : [...caps, c]);
  };

  if (branchesQ.isLoading) {
    return (
      <div className="max-w-4xl mx-auto py-6 px-4">
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (branchesQ.isError) {
    return (
      <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Branch management</h1>
        </div>
        <Card className="p-4 text-sm text-destructive border-destructive/40" role="alert">
          Failed to load branches. The branches table may not be deployed yet.
          {" "}Run migration 142 and refresh.
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Branch management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Store locations, contacts, managers, hours, and document branding.
          </p>
        </div>
        {!editing && (
          <Button size="sm" onClick={startNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add branch
          </Button>
        )}
      </div>

      {!editing ? (
        <>
          {deleteMut.isError && (
            <p className="text-sm text-destructive">
              {errorMessage(deleteMut.error, "Archive failed")}
            </p>
          )}
          {branches.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No branches configured. Add your first store location.
            </Card>
          ) : (
            <div className="space-y-2">
              {branches.map((b) => (
                <Card key={b.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{b.display_name}</h3>
                        {b.short_code && (
                          <Badge variant="outline" className="text-[10px]">{b.short_code}</Badge>
                        )}
                        {!b.is_active && (
                          <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{b.slug}</p>
                      {b.city && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {[b.address_line1, b.city, b.state_province, b.postal_code].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {b.phone_main && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {b.phone_main}
                        </p>
                      )}
                      {b.email_main && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {b.email_main}
                        </p>
                      )}
                      {b.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {b.capabilities.map((c) => (
                            <Badge key={c} variant="outline" className="text-[9px]">
                              {c.replace(/_/g, " ")}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        <Link to={`/qrm/branches/${b.slug}/command`}>Command</Link>
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Edit ${b.display_name}`} onClick={() => startEdit(b)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive"
                        aria-label={`Archive ${b.display_name}`}
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          if (confirm(`Archive "${b.display_name}"? This soft-deletes the branch.`)) {
                            deleteMut.mutate(b.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {editing.id ? `Edit: ${editing.display_name}` : "New branch"}
            </h2>
            <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
          </div>

          {/* Identity */}
          <Section icon={Building2} title="Identity">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field
                label="Display name *"
                value={editing.display_name}
                onChange={(v) => {
                  set("display_name", v);
                  if (!editing.id) set("slug", slugify(v));
                }}
                placeholder="Gulf Coast Depot"
                className="col-span-2"
              />
              <Field label="Slug" value={editing.slug ?? ""} onChange={(v) => set("slug", v)} placeholder="gulf-depot" />
              <Field label="Short code" value={editing.short_code ?? ""} onChange={(v) => set("short_code", v)} placeholder="GD" />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_active ?? true}
                  onChange={(e) => set("is_active", e.target.checked)}
                  className="rounded"
                />
                Active
              </label>
            </div>
          </Section>

          {/* Address */}
          <Section icon={MapPin} title="Address">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Address line 1" value={editing.address_line1 ?? ""} onChange={(v) => set("address_line1", v)} placeholder="123 Industrial Blvd" className="sm:col-span-2" />
              <Field label="Address line 2" value={editing.address_line2 ?? ""} onChange={(v) => set("address_line2", v)} placeholder="Suite A" className="sm:col-span-2" />
              <Field label="City" value={editing.city ?? ""} onChange={(v) => set("city", v)} placeholder="Lake City" />
              <Field label="State" value={editing.state_province ?? ""} onChange={(v) => set("state_province", v)} placeholder="FL" />
              <Field label="Postal code" value={editing.postal_code ?? ""} onChange={(v) => set("postal_code", v)} placeholder="32055" />
              <Field label="Country" value={editing.country ?? "US"} onChange={(v) => set("country", v)} />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Latitude" value={String(editing.latitude ?? "")} onChange={(v) => set("latitude", v ? Number(v) : null)} type="number" className="w-36" />
              <Field label="Longitude" value={String(editing.longitude ?? "")} onChange={(v) => set("longitude", v ? Number(v) : null)} type="number" className="w-36" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={geocoding || !(editing.city || editing.address_line1)}
                onClick={runGeocode}
              >
                {geocoding ? <Loader2 className="h-3 w-3 animate-spin" /> : <LocateFixed className="h-3 w-3" />}
                {geocoding ? "Looking up…" : "Auto-detect from address"}
              </Button>
            </div>
            {geoError && <p className="text-xs text-destructive">{geoError}</p>}
          </Section>

          {/* Contact */}
          <Section icon={Phone} title="Phone & Email">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Main phone" value={editing.phone_main ?? ""} onChange={(v) => set("phone_main", v)} placeholder="(386) 555-1000" />
              <Field label="Parts phone" value={editing.phone_parts ?? ""} onChange={(v) => set("phone_parts", v)} placeholder="(386) 555-1001" />
              <Field label="Service phone" value={editing.phone_service ?? ""} onChange={(v) => set("phone_service", v)} placeholder="(386) 555-1002" />
              <Field label="Sales phone" value={editing.phone_sales ?? ""} onChange={(v) => set("phone_sales", v)} placeholder="(386) 555-1003" />
              <Field label="Fax" value={editing.fax ?? ""} onChange={(v) => set("fax", v)} />
              <Field label="Main email" value={editing.email_main ?? ""} onChange={(v) => set("email_main", v)} placeholder="info@depot.com" />
              <Field label="Parts email" value={editing.email_parts ?? ""} onChange={(v) => set("email_parts", v)} />
              <Field label="Service email" value={editing.email_service ?? ""} onChange={(v) => set("email_service", v)} />
              <Field label="Sales email" value={editing.email_sales ?? ""} onChange={(v) => set("email_sales", v)} />
              <Field label="Website" value={editing.website_url ?? ""} onChange={(v) => set("website_url", v)} className="sm:col-span-2" />
            </div>
          </Section>

          {/* Managers */}
          <Section icon={Users} title="Management" defaultOpen={false}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PersonPicker label="General Manager" value={editing.general_manager_id ?? null} onChange={(v) => set("general_manager_id", v)} members={members} />
              <PersonPicker label="Sales Manager" value={editing.sales_manager_id ?? null} onChange={(v) => set("sales_manager_id", v)} members={members} />
              <PersonPicker label="Service Manager" value={editing.service_manager_id ?? null} onChange={(v) => set("service_manager_id", v)} members={members} />
              <PersonPicker label="Parts Manager" value={editing.parts_manager_id ?? null} onChange={(v) => set("parts_manager_id", v)} members={members} />
            </div>
          </Section>

          {/* Business hours */}
          <Section icon={Clock} title="Business Hours" defaultOpen={false}>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                <button
                  key={dow}
                  type="button"
                  className={`text-[11px] px-2 py-1 rounded border ${hours.find((h) => h.dow === dow) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                  onClick={() => toggleDow(dow)}
                >
                  {DOW_LABELS[dow]}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              {hours.map((h, i) => (
                <div key={h.dow} className="flex items-center gap-2 text-xs">
                  <span className="w-8 font-medium">{DOW_LABELS[h.dow]}</span>
                  <Input className="h-7 w-24 text-xs" type="time" value={h.open} onChange={(e) => setHour(i, "open", e.target.value)} />
                  <span className="text-muted-foreground">to</span>
                  <Input className="h-7 w-24 text-xs" type="time" value={h.close} onChange={(e) => setHour(i, "close", e.target.value)} />
                </div>
              ))}
            </div>
            <div className="pt-2">
              <label className="text-[11px] text-muted-foreground">Timezone</label>
              <select
                value={editing.timezone ?? "America/Chicago"}
                onChange={(e) => set("timezone", e.target.value)}
                className="block rounded border px-2 py-1 text-sm mt-0.5"
              >
                {US_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </Section>

          {/* Document branding */}
          <Section icon={FileText} title="Document Branding" defaultOpen={false}>
            <div className="grid grid-cols-1 gap-3">
              <BranchLogoUpload
                branchSlug={editing.slug || slugify(editing.display_name) || "new-branch"}
                currentUrl={editing.logo_url || null}
                onUploaded={(url) => set("logo_url", url)}
                onRemoved={() => set("logo_url", "")}
              />
              <Field label="Header tagline" value={editing.header_tagline ?? ""} onChange={(v) => set("header_tagline", v)} placeholder="Your Heavy Equipment Partner" />
              <div>
                <label className="text-[11px] text-muted-foreground block mb-0.5">Document footer text</label>
                <textarea
                  value={editing.doc_footer_text ?? ""}
                  onChange={(e) => set("doc_footer_text", e.target.value)}
                  className="w-full h-16 text-sm rounded border px-2 py-1.5 resize-none"
                  placeholder="Thank you for your business. Terms: Net 30."
                />
              </div>
            </div>
          </Section>

          {/* Tax / regulatory */}
          <Section icon={Shield} title="Tax & Regulatory" defaultOpen={false}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="Tax ID / EIN" value={editing.tax_id ?? ""} onChange={(v) => set("tax_id", v)} placeholder="XX-XXXXXXX" />
              <Field label="Default tax rate (%)" value={String((editing.default_tax_rate ?? 0) * 100)} onChange={(v) => set("default_tax_rate", (Number(v) || 0) / 100)} type="number" placeholder="7.5" />
            </div>
          </Section>

          {/* Capabilities */}
          <Section icon={Building2} title="Capabilities & Capacity" defaultOpen={false}>
            <div className="flex flex-wrap gap-1.5">
              {CAPABILITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`text-[11px] px-2 py-1 rounded border ${caps.includes(c) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                  onClick={() => toggleCap(c)}
                >
                  {c.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <Field label="Max service bays" value={String(editing.max_service_bays ?? "")} onChange={(v) => set("max_service_bays", v ? Number(v) : null)} type="number" />
              <Field label="Rental yard capacity" value={String(editing.rental_yard_capacity ?? "")} onChange={(v) => set("rental_yard_capacity", v ? Number(v) : null)} type="number" />
              <Field label="Delivery radius (mi)" value={String(editing.delivery_radius_miles ?? "")} onChange={(v) => set("delivery_radius_miles", v ? Number(v) : null)} type="number" />
            </div>
          </Section>

          {/* Notes */}
          <div>
            <label className="text-[11px] text-muted-foreground block mb-0.5">Internal notes</label>
            <textarea
              value={editing.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              className="w-full h-16 text-sm rounded border px-2 py-1.5 resize-none"
            />
          </div>

          {saveMut.isError && (
            <p className="text-sm text-destructive">{errorMessage(saveMut.error, "Save failed")}</p>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saveMut.isPending || !editing.display_name}>
              {saveMut.isPending ? "Saving…" : editing.id ? "Update branch" : "Create branch"}
            </Button>
            <Button variant="ghost" onClick={cancel}>Cancel</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
