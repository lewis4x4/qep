import { useState } from "react";
import { Search, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SalesGlobalSearch } from "./SalesGlobalSearch";

export function SalesTopHeader() {
  const { profile } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 bg-[hsl(var(--qep-dark))] border-b border-white/10">
        {/* Left: brand */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-qep-orange flex items-center justify-center">
            <span className="text-white font-bold text-sm">QEP</span>
          </div>
          <span className="text-white font-semibold text-sm">
            Sales Companion
          </span>
        </div>

        {/* Right: search + avatar */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            {profile?.full_name ? (
              <span className="text-white text-xs font-semibold">
                {profile.full_name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
            ) : (
              <User className="w-4 h-4 text-white/70" />
            )}
          </div>
        </div>
      </header>

      {searchOpen && (
        <SalesGlobalSearch onClose={() => setSearchOpen(false)} />
      )}
    </>
  );
}
