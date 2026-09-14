"use client"

import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

type AlertVariant = "error" | "success" | "warning" | "info"

interface AlertBannerProps {
  variant: AlertVariant
  message: string
  onDismiss?: () => void
  className?: string
}

const variantConfig = {
  error: {
    icon: AlertCircle,
    containerClass: "bg-error/10 border border-error/30 text-error",
    iconClass: "text-error",
  },
  success: {
    icon: CheckCircle2,
    containerClass: "bg-success/10 border border-success/30 text-success",
    iconClass: "text-success",
  },
  warning: {
    icon: AlertTriangle,
    containerClass: "bg-warning/10 border border-warning/30 text-warning",
    iconClass: "text-warning",
  },
  info: {
    icon: Info,
    containerClass: "bg-info/10 border border-info/30 text-info",
    iconClass: "text-info",
  },
}

export function AlertBanner({ variant, message, onDismiss, className }: AlertBannerProps) {
  const config = variantConfig[variant]
  const Icon = config.icon

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 p-4 text-sm",
        config.containerClass,
        className
      )}
    >
      <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", config.iconClass)} />
      <p className="flex-1">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={cn("p-1 hover:opacity-70 transition-opacity", config.iconClass)}
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
