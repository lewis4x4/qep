/**
 * QbNotificationBell — UI for qb_notifications inbox.
 *
 * Used in two shells:
 *   - SalesShell (mobile): tap opens a bottom sheet
 *   - TopBar (QRM desktop): tap opens a dropdown
 *
 * Surfaces both quote_approval_pending (manager) and quote_approval_decision
 * (rep) events from public.qb_notifications.
 *
 * Decision: NEW dedicated component rather than extending either existing
 * bell:
 *   - features/brief/components/NotificationBell — purely an unseen-count
 *     dot for hub_feedback_events; navigates to /brief/feedback. Different
 *     data source, different click behavior.
 *   - TopBar.useTopBarBell — reads crm_in_app_notifications and
 *     documents/voice_captures unseen counts; this slice's data is
 *     qb_notifications. Tangling a third source into useTopBarBell would
 *     bloat an already 100+ line hook with mixed concerns.
 *
 * Both existing bells stay untouched. This component mounts alongside the
 * TopBar bell in the QRM/desktop chrome and as the only bell in the
 * Sales Companion top header.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing, CheckCheck, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsHandheldViewport } from "@/features/sales/hooks/useIsHandheldViewport";
import {
  useQbNotifications,
  type QbNotification,
} from "@/features/sales/hooks/useQbNotifications";

export type QbNotificationBellTone = "light" | "dark";

interface QbNotificationBellProps {
  /**
   * Visual tone of the trigger button. "dark" renders white/translucent
   * (used in Sales Companion dark header + TopBar slate header).
   * "light" uses muted-foreground (default app surfaces).
   */
  tone?: QbNotificationBellTone;
  /** Optional override for the bell icon size (Tailwind class). */
  iconClassName?: string;
}

export function QbNotificationBell({
  tone = "light",
  iconClassName = "w-5 h-5",
}: QbNotificationBellProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const isHandheld = useIsHandheldViewport();
  const { notifications, unreadCount, markRead, markAllRead } =
    useQbNotifications();

  const triggerLabel =
    unreadCount > 0
      ? `Notifications — ${unreadCount} unread`
      : "Notifications";

  const triggerClass = cn(
    "relative inline-flex h-10 w-10 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-qep-orange",
    tone === "dark"
      ? "text-white/70 hover:text-white hover:bg-white/10"
      : "text-muted-foreground hover:text-foreground hover:bg-muted",
  );

  function handleSelect(notification: QbNotification) {
    if (!notification.read_at) {
      markRead(notification.id);
    }
    const link =
      typeof notification.metadata?.deep_link === "string"
        ? notification.metadata.deep_link
        : null;
    setOpen(false);
    if (link) {
      navigate(link);
    }
  }

  function handleMarkAllRead() {
    if (unreadCount === 0) return;
    markAllRead();
  }

  function handleViewAllApprovals() {
    setOpen(false);
    navigate("/sales/my-approvals");
  }

  const Trigger = (
    <button
      type="button"
      aria-label={triggerLabel}
      aria-haspopup={isHandheld ? "dialog" : "menu"}
      className={triggerClass}
    >
      {unreadCount > 0 ? (
        <BellRing className={iconClassName} aria-hidden />
      ) : (
        <Bell className={iconClassName} aria-hidden />
      )}
      {unreadCount > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-qep-orange px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );

  const InboxBody = (
    <NotificationList
      notifications={notifications}
      unreadCount={unreadCount}
      onSelect={handleSelect}
      onMarkAllRead={handleMarkAllRead}
      onViewAllApprovals={handleViewAllApprovals}
    />
  );

  if (isHandheld) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <button
          type="button"
          aria-label={triggerLabel}
          onClick={() => setOpen(true)}
          className={triggerClass}
        >
          {unreadCount > 0 ? (
            <BellRing className={iconClassName} aria-hidden />
          ) : (
            <Bell className={iconClassName} aria-hidden />
          )}
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-qep-orange px-1 text-[10px] font-semibold leading-none text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <SheetContent
          side="bottom"
          className="max-h-[80vh] overflow-y-auto rounded-t-2xl px-0 pb-6 pt-4"
        >
          <SheetHeader className="px-5 pb-3">
            <SheetTitle className="flex items-center justify-between gap-3">
              <span>Notifications</span>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1 text-xs font-medium text-qep-orange hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                  Mark all read
                </button>
              ) : null}
            </SheetTitle>
          </SheetHeader>
          <NotificationList
            notifications={notifications}
            unreadCount={unreadCount}
            onSelect={handleSelect}
            onMarkAllRead={handleMarkAllRead}
            onViewAllApprovals={handleViewAllApprovals}
            hideHeader
          />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{Trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[22rem] max-h-[min(70vh,440px)] overflow-y-auto p-0"
      >
        {InboxBody}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface NotificationListProps {
  notifications: QbNotification[];
  unreadCount: number;
  onSelect: (notification: QbNotification) => void;
  onMarkAllRead: () => void;
  /** When true, omit the inline list header (used inside the mobile sheet
   *  where SheetHeader already supplies title + mark-all action). */
  hideHeader?: boolean;
  /** Navigate handler for the "View all submitted approvals" footer link.
   *  Lifted from the host (component owns dropdown/sheet close + nav). */
  onViewAllApprovals?: () => void;
}

function NotificationList({
  notifications,
  unreadCount,
  onSelect,
  onMarkAllRead,
  hideHeader = false,
  onViewAllApprovals,
}: NotificationListProps) {
  if (notifications.length === 0) {
    return (
      <div className="flex flex-col">
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <CheckCircle2
            className="h-7 w-7 text-qep-orange/70"
            aria-hidden
          />
          <p className="text-sm font-medium text-foreground">
            You&apos;re all caught up.
          </p>
          <p className="text-xs text-muted-foreground">
            New approval activity will appear here.
          </p>
        </div>
        {onViewAllApprovals && (
          <ApprovalsFooterLink onClick={onViewAllApprovals} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notifications
            {unreadCount > 0 ? (
              <span className="ml-2 text-qep-orange tabular-nums">
                {unreadCount} unread
              </span>
            ) : null}
          </span>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="inline-flex items-center gap-1 text-xs font-medium text-qep-orange hover:underline"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              Mark all read
            </button>
          ) : null}
        </div>
      )}
      <ul role="list" className="divide-y divide-border">
        {notifications.map((notification) => (
          <li key={notification.id}>
            <button
              type="button"
              onClick={() => onSelect(notification)}
              className={cn(
                "flex w-full flex-col items-start gap-1 px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted",
                !notification.read_at && "bg-qep-orange/[0.04]",
              )}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span
                  className={cn(
                    "text-sm leading-snug",
                    notification.read_at
                      ? "text-foreground/80"
                      : "font-semibold text-foreground",
                  )}
                >
                  {notification.title}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {formatRelative(notification.created_at)}
                </span>
              </div>
              {notification.body ? (
                <span className="line-clamp-1 text-xs text-muted-foreground">
                  {notification.body}
                </span>
              ) : null}
              {!notification.read_at && (
                <span
                  aria-hidden
                  className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-qep-orange"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      {onViewAllApprovals && (
        <ApprovalsFooterLink onClick={onViewAllApprovals} />
      )}
    </div>
  );
}

function ApprovalsFooterLink({ onClick }: { onClick: () => void }) {
  return (
    <div className="border-t border-border px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        className="w-full text-center text-xs font-semibold text-qep-orange hover:underline"
      >
        View all submitted approvals →
      </button>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
