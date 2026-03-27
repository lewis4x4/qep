import { useState, useEffect, useCallback } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface UserRecord {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  status: "active" | "pending";
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
  const [filter, setFilter] = useState<FilterTab>("all");

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("rep");
  const [inviting, setInviting] = useState(false);

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [roleDialog, setRoleDialog] = useState<UserRecord | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRole>("rep");
  const [deactivateTarget, setDeactivateTarget] = useState<UserRecord | null>(null);

  const isOwner = callerRole === "owner";
  const inviteRoleOptions: UserRole[] = isOwner ? ROLE_OPTIONS : ["rep"];

  const loadUsers = useCallback(async () => {
    setLoading(true);
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
      toast({
        title: "Failed to load team",
        description: err instanceof Error ? err.message : "Unknown error",
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
    setInviting(true);
    try {
      await callAdminUsers({
        action: "invite",
        email: inviteEmail.trim().toLowerCase(),
        full_name: inviteName.trim(),
        role: inviteRole,
      });
      toast({ title: "Invite sent", description: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail("");
      setInviteName("");
      setInviteRole("rep");
      setShowInvite(false);
      await loadUsers();
    } catch (err) {
      toast({
        title: "Invite failed",
        description: err instanceof Error ? err.message : "Invite failed",
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

  const filteredUsers = users.filter((u) => {
    if (filter === "active") return u.is_active;
    if (filter === "inactive") return !u.is_active;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Team Members</h2>
          <p className="text-sm text-muted-foreground">
            {users.filter((u) => u.is_active).length} active member
            {users.filter((u) => u.is_active).length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowInvite((v) => !v)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Invite User
        </Button>
      </div>

      {showInvite && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">Invite a new team member</h3>
            <form onSubmit={(e) => void handleInvite(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              </div>
              <div className="max-w-48 space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {inviteRoleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={inviting} size="sm">
                  {inviting ? "Sending…" : "Send Invite"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowInvite(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-1">
        {(["all", "active", "inactive"] as FilterTab[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(f)}
            className="capitalize"
          >
            {f}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-md animate-pulse" />
          ))}
        </div>
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
            {filteredUsers.map((user) => {
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
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="hidden lg:table-cell">Last Login</TableHead>
                {isOwner && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => {
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
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                          ROLE_BADGE_CLASS[user.role]
                        )}
                      >
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
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
                                className="h-7 w-7 p-0"
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
              className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
  );
}
