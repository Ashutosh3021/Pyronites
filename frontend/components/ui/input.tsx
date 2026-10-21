import * as React from "react"
import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full border border-seam bg-plate-raised px-3 py-1 text-[13px] text-ink",
        "transition-colors placeholder:text-ink-faint",
        "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-[12px] file:font-medium file:text-ink",
        className
      )}
      {...props}
    />
  )
}

export { Input }
