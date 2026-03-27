import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-[8px] border border-qep-light-gray bg-white px-3 py-2 text-sm text-qep-charcoal ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-qep-charcoal placeholder:text-[#A0AEC0] focus-visible:outline-none focus-visible:border-qep-orange focus-visible:ring-2 focus-visible:ring-qep-orange/15 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
