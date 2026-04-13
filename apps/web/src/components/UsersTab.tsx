import { useState, useEffect, useCallback } from "react";
import { MoreHorizontal, UserPlus, HelpCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../lib/database.types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  rep: "Field sales rep. Can record voice notes and use the chat assistant.",
  admin: "Manages knowledge base documents. Can upload and toggle docs.",
  manager: "Manages team knowledge and documents. Can view all team activity.",
  owner: "Full access. Manages team members, roles, and all settings.",
};

type Department = "sales" | "parts" | "service" | "rentals" | "";

const DEPARTMENT_OPTIONS: { value: Department; label: string; ironRole: string }[] = [
  { value: "",        label: "— None (default)",  ironRole: "" },
  { value: "sales",   label: "Sales",             ironRole: "iron_advisor" },
  { value: "parts",   label: "Parts",             ironRole: "iron_woman" },
  { value: "service",  label: "Service",           ironRole: "iron_man" },
  { value: "rentals", label: "Rentals",            ironRole: "iron_advisor" },
];

const IRON_ROLE_DISPLAY: Record<string, string> = {
  iron_advisor: "Sales",
  iron_woman: "Parts",
  iron_man: "Service",
  iron_manager: "Management",
};

const PAGE_SIZE = 10;

interface UserRecord {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  status: "active" | "pending";
  iron_role?: string | null;
}

export interface UsersTabProps {
  callerRole: UserRole;
  callerId: string;
}

const ROLE_OPTIONS: UserRole[] = ["rep", "admin", "manager", "owner"];

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  rep: "bg-muted text-muted-foreground",
  admin: "bg-primary/10 text-primary",
  manager: "bg-accent/20 text-accent-foreground",
  owner: "bg-accent text-accent-foreground",
};

function formatLastLogin(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getInitials(name: string | null, email: string | null): string {
  if (name) return name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  return email?.[0]?.toUpperCase() ?? "?";
}

type FilterTab = "all" | "active" | "inactive";

export function UsersTab({ callerRole, callerId }: UsersTabProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [page, setPage] = useState(1);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("rep");
  const [inviteDepartment, setInviteDepartment] = useState<Department>("");
  const [inviting, setInviting] = useState(false);
  const [inviteMode, setInviteMode] = useState<"invite" | "create">("invite");
  const [invitePassword, setInvitePassword] = useState("");

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [roleDialog, setRoleDialog] = useState<UserRecord | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRole>("rep");
  const [deactivateTarget, setDeactivateTarget] = useState<UserRecord | null>(null);
  const [deptDialog, setDeptDialog] = useState<UserRecord | null>(null);
  const [pendingDept, setPendingDept] = useState<string>("");

  const isOwner = callerRole === "owner";
  const inviteRoleOptions: UserRole[] = isOwner ? ROLE_OPTIONS : ["rep"];

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=list`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      const json = (await res.json()) as { users?: UserRecord[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load users");
      setUsers(json.users ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setLoadError(message);
      toast({
        title: "Failed to load team",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function callAdminUsers(body: Record<string, unknown>): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Request failed");
  }

  async function handleInvite(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    if (inviteMode === "create" && invitePassword.length < 8) return;
    setInviting(true);
    try {
      const deptOption = DEPARTMENT_OPTIONS.find((d) => d.value === inviteDepartment);
      const payload: Record<string, unknown> = {
        action: inviteMode,
        email: inviteEmail.trim().toLowerCase(),
        full_name: inviteName.trim(),
        role: inviteRole,
        ...(deptOption?.ironRole ? { iron_role: deptOption.ironRole } : {}),
      };
      if (inviteMode === "create") {
        payload.password = invitePassword;
      }
      await callAdminUsers(payload);
      toast({
        title: inviteMode === "create" ? "User created" : "Invite sent",
        description: inviteMode === "create"
          ? `${inviteName.trim()} can now sign in.`
          : `Invite sent to ${inviteEmail.trim()}`,
      });
      setInviteEmail("");
      setInviteName("");
      setInviteRole("rep");
      setInviteDepartment("");
      setInvitePassword("");
      setShowInvite(false);
      await loadUsers();
    } catch (err) {
      toast({
        title: inviteMode === "create" ? "Creation failed" : "Invite failed",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  }

  async function confirmRoleChange(): Promise<void> {
    if (!roleDialog) return;
    const userId = roleDialog.id;
    setRoleDialog(null);
    setPendingAction(userId + "-role");
    try {
      await callAdminUsers({ action: "update-role", userId, role: pendingRole });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: pendingRole } : u)));
      toast({ title: "Role updated" });
    } catch (err) {
      toast({
        title: "Role update failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmDeptChange(): Promise<void> {
    if (!deptDialog) return;
    const userId = deptDialog.id;
    setDeptDialog(null);
    setPendingAction(userId + "-dept");
    try {
      await callAdminUsers({ action: "update-department", userId, iron_role: pendingDept });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, iron_role: pendingDept || null } : u)));
      toast({ title: "Department updated" });
    } catch (err) {
      toast({
        title: "Department update failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmToggleActive(): Promise<void> {
    if (!deactivateTarget) return;
    const { id: userId, is_active } = deactivateTarget;
    setDeactivateTarget(null);
    setPendingAction(userId + "-active");
    try {
      await callAdminUsers({ action: "set-active", userId, is_active: !is_active });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_active: !is_active } : u))
      );
      toast({ title: is_active ? "User deactivated" : "User reactivated" });
    } catch (err) {
      toast({
        title: "Failed to update status",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  }

  const filterCounts = {
    all: users.length,
    active: users.filter((u) => u.is_active).length,
    inactive: users.filter((u) => !u.is_active).length,
  };

  const filteredUsers = users.filter((u) => {
    if (filter === "active") return u.is_active;
    if (filter === "inactive") return !u.is_active;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const pagedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Team Members</h2>
          <p className="text-sm text-muted-foreground">
            {filterCounts.active} active member
            {filterCounts.active !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowInvite(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={(open) => {
        setShowInvite(open);
        if (!open) { setInviteMode("invite"); setInvitePassword(""); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add team member</DialogTitle>
            <DialogDescription>
              {inviteMode === "create"
                ? "Create an account with a password. The user can sign in immediately."
                : "They'll receive an email to set up their account."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleInvite(e)} className="space-y-4 pt-1">
            {/* Mode toggle */}
            <div className="flex rounded-md border border-input overflow-hidden">
              <button
                type="button"
                onClick={() => setInviteMode("invite")}
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
                  inviteMode === "invite"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                Send Invite
              </button>
              <button
                type="button"
                onClick={() => setInviteMode("create")}
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
                  inviteMode === "create"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                Create Directly
              </button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full Name</Label>
              <Input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Work Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="jane@qualityequipmentparts.com"
                required
              />
            </div>
            {inviteMode === "create" && (
              <div className="space-y-1.5">
                <Label htmlFor="invite-password">Password</Label>
                <Input
                  id="invite-password"
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  minLength={8}
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="Role info" className="inline-flex items-center justify-center">
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    {ROLE_DESCRIPTIONS[inviteRole]}
                  </TooltipContent>
                </Tooltip>
              </div>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qep-orange"
              >
                {inviteRoleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="invite-department">Department</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="Department info" className="inline-flex items-center justify-center">
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    Determines which companion the user sees on login (Sales, Parts, Service, or Rentals).
                  </TooltipContent>
                </Tooltip>
              </div>
              <select
                id="invite-department"
                value={inviteDepartment}
                onChange={(e) => setInviteDepartment(e.target.value as Department)}
                className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qep-orange"
              >
                {DEPARTMENT_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setShowInvite(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting
                  ? (inviteMode === "create" ? "Creating…" : "Sending…")
                  : (inviteMode === "create" ? "Create User" : "Send Invite")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex gap-1">
        {(["all", "active", "inactive"] as FilterTab[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            onClick={() => { setFilter(f); setPage(1); }}
            className="capitalize"
          >
            {f}
            <span className="ml-1.5 text-xs opacity-60">({filterCounts[f]})</span>
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-md animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-sm text-destructive font-medium">Failed to load team members</p>
            <p className="text-xs text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadUsers()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : filteredUsers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {filter === "all"
                ? "No team members yet. Invite someone to get started."
                : `No ${filter} members.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile card layout — below md */}
          <div className="md:hidden space-y-2">
            {pagedUsers.map((user) => {
              const isMe = user.id === callerId;
              const busy =
                pendingAction === user.id + "-role" ||
                pendingAction === user.id + "-active";
              return (
                <Card key={user.id} className={cn(!user.is_active && "opacity-60")}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Avatar className="w-9 h-9 shrink-0">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">
                          {getInitials(user.full_name, user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {user.full_name ?? "—"}
                          {isMe && (
                            <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                          ROLE_BADGE_CLASS[user.role]
                        )}
                      >
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                      <Badge
                        variant={
                          !user.is_active
                            ? "destructive"
                            : user.status === "pending"
                            ? "secondary"
                            : "default"
                        }
                        className="text-xs"
                      >
                        {!user.is_active
                          ? "Deactivated"
                          : user.status === "pending"
                          ? "Invite Pending"
                          : "Active"}
                      </Badge>
                    </div>
                    {isOwner && !isMe && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setPendingRole(user.role);
                            setRoleDialog(user);
                          }}
                          className="flex-1 min-h-[44px]"
                        >
                          Change Role
                        </Button>
                        <Button
                          variant={user.is_active ? "destructive" : "outline"}
                          size="sm"
                          disabled={busy}
                          onClick={() => setDeactivateTarget(user)}
                          className="flex-1 min-h-[44px]"
                        >
                          {user.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Table layout — md and above */}
          <div className="hidden md:block">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Dept</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="hidden lg:table-cell">Last Login</TableHead>
                {isOwner && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedUsers.map((user) => {
                const isMe = user.id === callerId;
                const busy =
                  pendingAction === user.id + "-role" ||
                  pendingAction === user.id + "-active";

                return (
                  <TableRow
                    key={user.id}
                    className={cn(!user.is_active && "opacity-60")}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {getInitials(user.full_name, user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {user.full_name ?? "—"}
                            {isMe && (
                              <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground sm:hidden">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell truncate max-w-48">
                      {user.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium cursor-default",
                              ROLE_BADGE_CLASS[user.role]
                            )}
                          >
                            {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[200px]">
                          {ROLE_DESCRIPTIONS[user.role]}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {user.iron_role ? (
                        <span className="text-xs text-muted-foreground">
                          {IRON_ROLE_DISPLAY[user.iron_role] ?? user.iron_role}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            !user.is_active
                              ? "bg-destructive"
                              : user.status === "pending"
                              ? "bg-amber-400"
                              : "bg-green-500"
                          )}
                        />
                        <Badge
                          variant={
                            !user.is_active
                              ? "destructive"
                              : user.status === "pending"
                              ? "secondary"
                              : "default"
                          }
                          className="text-xs"
                        >
                          {!user.is_active
                            ? "Deactivated"
                            : user.status === "pending"
                            ? "Invite Pending"
                            : "Active"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                      {formatLastLogin(user.last_sign_in_at)}
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-right">
                        {!isMe && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                className="h-9 w-9 p-0"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setPendingRole(user.role);
                                  setRoleDialog(user);
                                }}
                              >
                                Change Role
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setPendingDept(user.iron_role ?? "");
                                  setDeptDialog(user);
                                }}
                              >
                                Change Department
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeactivateTarget(user)}
                                className={
                                  user.is_active
                                    ? "text-destructive focus:text-destructive"
                                    : ""
                                }
                              >
                                {user.is_active ? "Deactivate" : "Reactivate"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="h-10 w-10 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="h-10 w-10 p-0"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Role Change Dialog */}
      <Dialog open={!!roleDialog} onOpenChange={(open) => !open && setRoleDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update the role for {roleDialog?.full_name ?? roleDialog?.email ?? "this user"}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="role-select" className="text-sm mb-1.5 block">
              New Role
            </Label>
            <select
              id="role-select"
              value={pendingRole}
              onChange={(e) => setPendingRole(e.target.value as UserRole)}
              className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qep-orange"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmRoleChange()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Department Change Dialog */}
      <Dialog open={!!deptDialog} onOpenChange={(open) => !open && setDeptDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Department</DialogTitle>
            <DialogDescription>
              Update the department for {deptDialog?.full_name ?? deptDialog?.email ?? "this user"}.
              This determines which companion they see on login.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="dept-select" className="text-sm mb-1.5 block">
              Department
            </Label>
            <select
              id="dept-select"
              value={pendingDept}
              onChange={(e) => setPendingDept(e.target.value)}
              className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qep-orange"
            >
              <option value="">— None</option>
              <option value="iron_advisor">Sales</option>
              <option value="iron_woman">Parts</option>
              <option value="iron_man">Service</option>
              <option value="iron_manager">Management</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmDeptChange()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation Dialog */}
      <Dialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deactivateTarget?.is_active ? "Deactivate" : "Reactivate"} user?
            </DialogTitle>
            <DialogDescription>
              {deactivateTarget?.is_active
                ? `${deactivateTarget?.full_name ?? deactivateTarget?.email} will lose access immediately.`
                : `${deactivateTarget?.full_name ?? deactivateTarget?.email} will regain access to the platform.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={deactivateTarget?.is_active ? "destructive" : "default"}
              onClick={() => void confirmToggleActive()}
            >
              {deactivateTarget?.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
