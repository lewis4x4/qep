import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-qep-light-gray disabled:text-[#A0AEC0] disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary CTA — QEP orange
        default:
          "bg-qep-orange text-white hover:bg-qep-orange-hover",
        // Secondary — white bg, dark navy text, light gray border
        secondary:
          "bg-white text-qep-dark border border-qep-light-gray hover:bg-qep-bg",
        // Destructive — white bg, red text/border, red fill on hover
        destructive:
          "bg-white text-qep-error border border-qep-error hover:bg-qep-error hover:text-white",
        // Outline — alias for secondary
        outline:
          "bg-white text-qep-dark border border-qep-light-gray hover:bg-qep-bg",
        // Ghost — transparent bg, slate text
        ghost:
          "bg-transparent text-qep-slate hover:bg-qep-bg",
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
