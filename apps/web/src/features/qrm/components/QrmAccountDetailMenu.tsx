import { Link, useLocation } from "react-router-dom";
import {
  Building2,
  ChevronDown,
  Clock,
  Dna,
  Gauge,
  GitMerge,
  LayoutGrid,
  Mic,
  MoreHorizontal,
  Network,
  Radar,
  Radio,
  Repeat,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  buildAccountDetailMenuItems,
  type AccountDetailMenuItem,
  type AccountDetailMenuKey,
} from "../lib/account-detail-menu";
import { accountFleetRadarUrl, legacyAccountDetailUrl } from "../lib/account-links";

interface QrmAccountDetailMenuProps {
  accountId: string;
  className?: string;
}

const MENU_ICONS: Record<AccountDetailMenuKey, LucideIcon> = {
  legacy: Building2,
  "voice-note": Mic,
  timeline: Clock,
  genome: Dna,
  "operating-profile": Gauge,
  "fleet-intelligence": Radio,
  "relationship-map": Network,
  "white-space": LayoutGrid,
  "rental-conversion": Repeat,
  strategist: Sparkles,
  "fleet-radar": Radar,
  duplicates: GitMerge,
};

const MENU_GROUPS: Array<{
  label: string;
  keys: AccountDetailMenuKey[];
}> = [
  { label: "Foundation", keys: ["legacy", "voice-note", "timeline"] },
  {
    label: "Intelligence",
    keys: ["genome", "operating-profile", "fleet-intelligence", "relationship-map", "white-space"],
  },
  { label: "Strategy", keys: ["rental-conversion", "strategist", "fleet-radar"] },
  { label: "Admin", keys: ["duplicates"] },
];

const COMPACT_KEYS: AccountDetailMenuKey[] = ["genome", "operating-profile", "fleet-intelligence", "strategist"];

function isActiveAccountMenuItem(item: AccountDetailMenuItem, pathname: string, accountId: string): boolean {
  if (item.key === "legacy") {
    return pathname === legacyAccountDetailUrl(accountId);
  }
  if (item.key === "fleet-radar") {
    return pathname === accountFleetRadarUrl(accountId);
  }
  if (item.key === "duplicates") {
    return pathname === "/admin/duplicates" || pathname.startsWith("/admin/duplicates/") || pathname === "/qrm/duplicates";
  }
  if (item.key === "voice-note") {
    return pathname === "/voice-qrm";
  }
  return pathname === item.href;
}

function menuItemClass(active: boolean, layout: "chip" | "sheet" = "chip"): string {
  return cn(
    "group border-qep-deck-rule/60 bg-card/80 text-foreground/85 transition-colors hover:border-qep-orange/35 hover:bg-qep-deck-elevated/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-qep-orange/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    layout === "chip"
      ? "min-h-[40px] shrink-0 rounded-full px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em]"
      : "min-h-[48px] w-full justify-start rounded-xl px-3 font-medium",
    active &&
      "border-qep-orange/60 bg-qep-orange/10 text-foreground shadow-[inset_0_0_0_1px_rgba(255,121,0,0.18)]",
  );
}

function AccountMenuLink({
  item,
  accountId,
  pathname,
  layout = "chip",
}: {
  item: AccountDetailMenuItem;
  accountId: string;
  pathname: string;
  layout?: "chip" | "sheet";
}) {
  const active = isActiveAccountMenuItem(item, pathname, accountId);
  const Icon = MENU_ICONS[item.key];

  const content = (
    <>
      {active ? <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-qep-orange" aria-hidden /> : null}
      <Icon className={cn("h-3.5 w-3.5", layout === "chip" ? "mr-1.5" : "mr-2 h-4 w-4")} aria-hidden />
      <span>{item.label}</span>
    </>
  );

  if (layout === "sheet") {
    return (
      <SheetClose asChild>
        <Link
          to={item.href}
          aria-current={active ? "page" : undefined}
          className={cn("inline-flex items-center", menuItemClass(active, "sheet"))}
        >
          {content}
        </Link>
      </SheetClose>
    );
  }

  return (
    <Button asChild variant="outline" size="sm" className={menuItemClass(active)}>
      <Link to={item.href} aria-current={active ? "page" : undefined}>
        {content}
      </Link>
    </Button>
  );
}

function AccountMenuSheet({
  accountId,
  pathname,
  itemsByKey,
  triggerLabel,
  triggerClassName,
}: {
  accountId: string;
  pathname: string;
  itemsByKey: Map<AccountDetailMenuKey, AccountDetailMenuItem>;
  triggerLabel: "Views" | "More";
  triggerClassName?: string;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "min-h-[44px] rounded-full border-qep-deck-rule/60 bg-card/85 px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] focus-visible:ring-2 focus-visible:ring-qep-orange/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            triggerClassName,
          )}
          aria-label={`${triggerLabel} account views`}
        >
          {triggerLabel === "More" ? <MoreHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden /> : null}
          {triggerLabel}
          <ChevronDown className="ml-1.5 h-3.5 w-3.5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl border-qep-deck-rule bg-background/98 p-5 sm:left-auto sm:right-4 sm:top-20 sm:h-auto sm:max-w-md sm:rounded-2xl sm:border">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>Account views</SheetTitle>
          <SheetDescription>
            Jump between this account&apos;s command, intelligence, strategy, and admin surfaces.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-5">
          {MENU_GROUPS.map((group) => (
            <section key={group.label} aria-labelledby={`account-menu-${group.label.toLowerCase()}`} className="space-y-2">
              <h3
                id={`account-menu-${group.label.toLowerCase()}`}
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
              >
                {group.label}
              </h3>
              <div className="grid gap-2">
                {group.keys.map((key) => {
                  const item = itemsByKey.get(key);
                  if (!item) return null;
                  return <AccountMenuLink key={item.key} item={item} accountId={accountId} pathname={pathname} layout="sheet" />;
                })}
              </div>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function QrmAccountDetailMenu({ accountId, className }: QrmAccountDetailMenuProps) {
  const location = useLocation();
  const itemsByKey = new Map(buildAccountDetailMenuItems(accountId).map((item) => [item.key, item]));

  return (
    <nav aria-label="Account detail menu" className={cn("w-full", className)}>
      <div className="flex items-center justify-end xl:hidden">
        <AccountMenuSheet
          accountId={accountId}
          pathname={location.pathname}
          itemsByKey={itemsByKey}
          triggerLabel="Views"
          triggerClassName="md:hidden"
        />
        <div className="hidden w-full items-center justify-end gap-2 md:flex xl:hidden">
          {COMPACT_KEYS.map((key) => {
            const item = itemsByKey.get(key);
            if (!item) return null;
            return <AccountMenuLink key={item.key} item={item} accountId={accountId} pathname={location.pathname} />;
          })}
          <AccountMenuSheet accountId={accountId} pathname={location.pathname} itemsByKey={itemsByKey} triggerLabel="More" />
        </div>
      </div>

      <div className="hidden min-w-0 items-center justify-end gap-3 xl:flex">
        {MENU_GROUPS.map((group) => (
          <div
            key={group.label}
            className="flex items-center gap-1.5 border-l border-qep-deck-rule/50 pl-3 first:border-l-0 first:pl-0"
          >
            <span className="sr-only">{group.label}</span>
            {group.keys.map((key) => {
              const item = itemsByKey.get(key);
              if (!item) return null;
              return <AccountMenuLink key={item.key} item={item} accountId={accountId} pathname={location.pathname} />;
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
