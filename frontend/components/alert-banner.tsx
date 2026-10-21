'use client'

import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

type AlertVariant = "error" | "success" | "warning" | "info"

interface AlertBannerProps {
  variant: AlertVariant
  message: string
  onDismiss?: () => void
  className?: string
}

/**
 * The only error mechanism in the product. A plate with a lit left seam in the
 * signal colour, so severity is legible without relying on colour alone (the
 * icon and the wording carry it too).
 */
const variantConfig = {
  error: {
    icon: AlertCircle,
    seam: "var(--error)",
    text: "text-error",
  },
  success: {
    icon: CheckCircle2,
    seam: "var(--success)",
    text: "text-success",
  },
  warning: {
    icon: AlertTriangle,
    seam: "var(--warning)",
    text: "text-warning",
  },
  info: {
    icon: Info,
    seam: "var(--info)",
    text: "text-info",
  },
}

export function AlertBanner({ variant, message, onDismiss, className }: AlertBannerProps) {
  const config = variantConfig[variant]
  const Icon = config.icon

  return (
    <div
      role="alert"
      className={cn(
        "relative flex items-start gap-3 border border-seam bg-plate px-4 py-3 text-[13px] leading-relaxed text-ink",
        className
      )}
      style={{ boxShadow: `inset 2px 0 0 0 ${config.seam}` }}
    >
      <Icon className={cn("w-4 h-4 flex-shrink-0 mt-0.5", config.text)} aria-hidden="true" />
      <p className="flex-1">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={cn(
            "p-1 -mr-1 -mt-0.5 transition-colors hover:text-ink min-w-[28px] min-h-[28px] flex items-center justify-center",
            config.text
          )}
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
