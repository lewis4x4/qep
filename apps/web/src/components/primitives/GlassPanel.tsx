import React from 'react';
import { cn } from "@/lib/utils";

export const GlassPanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-white/10 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-2xl relative overflow-hidden",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

GlassPanel.displayName = "GlassPanel";
