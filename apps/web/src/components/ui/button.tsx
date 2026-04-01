import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary CTA — QEP orange
        default:
          "bg-qep-orange text-white hover:bg-qep-orange-hover disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
        // Secondary — frosted glass (light) / crystal (dark)
        secondary:
          "border border-slate-200/85 bg-gradient-to-b from-white/90 to-slate-100/65 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.85),0_2px_14px_-6px_rgba(15,23,42,0.12)] backdrop-blur-md hover:from-white hover:to-slate-100/75 dark:border-white/[0.12] dark:from-white/[0.09] dark:to-white/[0.035] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_10px_36px_-14px_rgba(0,0,0,0.5)] dark:hover:from-white/[0.12] dark:hover:to-white/[0.06]",
        // Destructive — card bg, red text/border, red fill on hover
        destructive:
          "bg-card text-destructive border border-destructive hover:bg-destructive hover:text-destructive-foreground disabled:border-border disabled:text-muted-foreground disabled:hover:bg-card",
        // Outline — crystal / glassmorphism (platform default for bordered actions)
        outline:
          "border border-slate-200/90 bg-gradient-to-b from-white/92 to-slate-50/78 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.92),0_2px_16px_-6px_rgba(15,23,42,0.14)] backdrop-blur-md hover:from-white hover:to-slate-50/88 dark:border-white/[0.14] dark:from-white/[0.11] dark:to-white/[0.045] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.09),0_12px_48px_-18px_rgba(0,0,0,0.55)] dark:hover:from-white/[0.15] dark:hover:to-white/[0.08]",
        // Ghost — transparent bg, muted text
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:hover:bg-transparent",
        // Link
        link: "text-qep-orange underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2.5",
        sm: "h-9 rounded-[8px] px-3",
        lg: "h-12 rounded-[8px] px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
