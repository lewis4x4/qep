import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-qep-orange focus:ring-offset-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
  {
    variants: {
      variant: {
        // Default — QEP orange badge
        default:
          "border-transparent bg-qep-orange text-white shadow-none backdrop-blur-none",
        // Secondary — frosted neutral
        secondary:
          "border-slate-200/80 bg-gradient-to-b from-white/88 to-slate-100/60 text-qep-charcoal dark:border-white/[0.12] dark:from-white/[0.08] dark:to-white/[0.03] dark:text-foreground",
        // Destructive — red
        destructive:
          "border-transparent bg-qep-error text-white shadow-none backdrop-blur-none",
        // Outline — crystal chip
        outline:
          "border-slate-200/90 bg-gradient-to-b from-white/90 to-slate-50/70 text-qep-charcoal dark:border-white/[0.14] dark:from-white/[0.1] dark:to-white/[0.04] dark:text-foreground",
        // Role / status variants
        success:
          "border-transparent bg-qep-success text-white shadow-none backdrop-blur-none",
        info:
          "border-transparent bg-qep-info text-white shadow-none backdrop-blur-none",
        warning:
          "border-transparent bg-qep-orange text-white shadow-none backdrop-blur-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
