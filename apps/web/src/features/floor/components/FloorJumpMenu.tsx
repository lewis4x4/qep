/**
 * FloorJumpMenu — "Jump to" dropdown inside FloorTopBar.
 *
 * Gives Floor-mode users a minimal navigation escape to the five
 * operator domains without reintroducing the legacy dense top nav.
 * Intentionally thin — this is NOT a navigation system. It's a
 * ripcord for the rare moment the rep needs to walk into QRM or
 * Parts at large instead of following a widget's deep link.
 *
 * Brand-native: charcoal menu, Bebas Neue caps on the trigger,
 * Montserrat on items, orange hover states.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  ChevronDown,
  FileText,
  PackageSearch,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";

interface JumpTarget {
  id: string;
  label: string;
  route: string;
  icon: LucideIcon;
}

const JUMP_TARGETS: JumpTarget[] = [
  { id: "qrm",     label: "QRM",     route: "/qrm",        icon: Building2 },
  { id: "sales",   label: "Sales",   route: "/sales/today", icon: FileText },
  { id: "parts",   label: "Parts",   route: "/parts",      icon: PackageSearch },
  { id: "service", label: "Service", route: "/service",    icon: Wrench },
  { id: "rentals", label: "Rentals", route: "/rentals",    icon: Warehouse },
];

export function FloorJumpMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="group inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] px-3 py-1.5 font-display text-xs tracking-[0.14em] text-foreground transition-colors hover:border-[hsl(var(--qep-orange))] hover:text-[hsl(var(--qep-orange))]"
      >
        JUMP TO
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] shadow-lg ring-1 ring-black/40"
        >
          <div className="border-b border-[hsl(var(--qep-deck-rule))] px-3 py-1.5">
            <span className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
              Operator surfaces
            </span>
          </div>
          <ul className="p-1">
            {JUMP_TARGETS.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.id}>
                  <Link
                    to={t.route}
                    onClick={() => setOpen(false)}
                    role="menuitem"
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-[hsl(var(--qep-orange))]/10 hover:text-[hsl(var(--qep-orange))]"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-[hsl(var(--qep-orange))]" aria-hidden="true" />
                    <span className="font-medium">{t.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[hsl(var(--qep-deck-rule))] px-3 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              Each keeps a Back to Floor chip pinned on top.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
