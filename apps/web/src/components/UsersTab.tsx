import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../lib/database.types";

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

interface UsersTabProps {
  callerRole: UserRole;
  callerId: string;
}

const ROLE_OPTIONS: UserRole[] = ["rep", "admin", "manager", "owner"];

const ROLE_COLORS: Record<UserRole, string> = {
  rep: "bg-gray-100 text-gray-700",
  admin: "bg-blue-100 text-blue-700",
  manager: "bg-purple-100 text-purple-700",
  owner: "bg-amber-100 text-amber-700",
};

function formatLastLogin(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function UsersTab({ callerRole, callerId }: UsersTabProps) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("rep");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Per-row action state
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const isOwner = callerRole === "owner";

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
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

      const json = await res.json() as { users?: UserRecord[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load users");
      setUsers(json.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function callAdminUsers(body: Record<string, unknown>): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
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

    const json = await res.json() as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Request failed");
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteName.trim()) return;

    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      await callAdminUsers({
        action: "invite",
        email: inviteEmail.trim().toLowerCase(),
        full_name: inviteName.trim(),
        role: inviteRole,
      });

      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("rep");
      setShowInvite(false);
      await loadUsers();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setPendingAction(userId + "-role");
    try {
      await callAdminUsers({ action: "update-role", userId, role });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Role update failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleToggleActive(userId: string, currentlyActive: boolean) {
    const label = currentlyActive ? "deactivate" : "reactivate";
    if (!confirm(`Are you sure you want to ${label} this user?`)) return;

    setPendingAction(userId + "-active");
    try {
      await callAdminUsers({ action: "set-active", userId, is_active: !currentlyActive });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_active: !currentlyActive } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account status");
    } finally {
      setPendingAction(null);
    }
  }

  // Roles a caller is allowed to assign when inviting
  const inviteRoleOptions: UserRole[] = isOwner
    ? ROLE_OPTIONS
    : ["rep"];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Team Members ({users.filter((u) => u.is_active).length} active)
        </h2>
        <button
          onClick={() => {
            setShowInvite((v) => !v);
            setInviteError(null);
            setInviteSuccess(null);
          }}
          className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Invite User
        </button>
      </div>

      {/* Success toast */}
      {inviteSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2.5 rounded-lg">
          {inviteSuccess}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg">
          {error}
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="mb-5 bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Invite a new team member</h3>
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Work Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="jane@qualityequipmentparts.com"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="max-w-48">
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {inviteRoleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            {inviteError && (
              <p className="text-red-600 text-sm">{inviteError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={inviting}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {inviting ? "Sending invite..." : "Send Invite"}
              </button>
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading team members...</p>
      ) : users.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">No team members yet. Invite someone to get started.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Last Login</th>
                {isOwner && (
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => {
                const isMe = user.id === callerId;
                const roleChanging = pendingAction === user.id + "-role";
                const activeChanging = pendingAction === user.id + "-active";

                return (
                  <tr key={user.id} className={`hover:bg-gray-50 ${!user.is_active ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 truncate max-w-36">
                        {user.full_name ?? "—"}
                        {isMe && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                      </div>
                      <div className="text-xs text-gray-500 sm:hidden truncate">{user.email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell truncate max-w-48">
                      {user.email ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {isOwner && !isMe ? (
                        <select
                          value={user.role}
                          disabled={roleChanging}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                          className={`text-xs font-medium px-2 py-1 rounded-full border-0 ring-1 ring-inset ring-gray-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${ROLE_COLORS[user.role]} disabled:opacity-50`}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role]}`}>
                          {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        !user.is_active
                          ? "bg-red-100 text-red-600"
                          : user.status === "pending"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                      }`}>
                        {!user.is_active ? "Deactivated" : user.status === "pending" ? "Invite Pending" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">
                      {formatLastLogin(user.last_sign_in_at)}
                    </td>
                    {isOwner && (
                      <td className="px-4 py-3">
                        {!isMe && (
                          <button
                            onClick={() => handleToggleActive(user.id, user.is_active)}
                            disabled={activeChanging}
                            className={`text-xs hover:underline disabled:opacity-50 ${
                              user.is_active ? "text-red-500" : "text-green-600"
                            }`}
                          >
                            {activeChanging
                              ? "Saving..."
                              : user.is_active
                              ? "Deactivate"
                              : "Reactivate"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
