import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-qep-orange focus:ring-offset-2",
  {
    variants: {
      variant: {
        // Default — QEP orange badge
        default:
          "bg-qep-orange text-white border-transparent",
        // Secondary — neutral gray
        secondary:
          "bg-qep-light-gray text-qep-charcoal border-transparent",
        // Destructive — red
        destructive:
          "bg-qep-error text-white border-transparent",
        // Outline
        outline:
          "text-qep-charcoal border border-qep-light-gray",
        // Role / status variants
        success:
          "bg-qep-success text-white border-transparent",
        info:
          "bg-qep-info text-white border-transparent",
        warning:
          "bg-qep-orange text-white border-transparent",
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
