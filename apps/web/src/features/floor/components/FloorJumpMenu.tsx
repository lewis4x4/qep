/**
 * FloorJumpMenu — compact role-home escape hatch to major work surfaces.
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
        className="group inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-300 transition-colors hover:border-[#f28a07]/40 hover:text-white"
      >
        Jump to
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#121927] shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] ring-1 ring-black/40"
        >
          <div className="border-b border-white/10 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Work surfaces
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
                    className="group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-slate-200 transition-colors hover:bg-[#f28a07]/10 hover:text-[#f6a53a]"
                  >
                    <Icon className="h-3.5 w-3.5 text-slate-500 group-hover:text-[#f6a53a]" aria-hidden="true" />
                    <span className="font-medium">{t.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-white/10 px-3 py-2">
            <span className="text-[10px] text-slate-500">
              Each keeps a Back to Floor chip pinned on top.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
