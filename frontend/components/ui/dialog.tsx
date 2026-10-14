"use client"

/**
 * Dialog primitives on Base UI.
 *
 * The previous hand-rolled version rendered `null` when closed, so there was no
 * exit transition, and it had no focus trap, no Escape handling and no scroll
 * lock — a keyboard user could tab straight out of an open modal into the page
 * behind it. Base UI provides all of that, including aria wiring.
 *
 * The exported names and props are unchanged so every call site still compiles.
 */

import * as React from "react"
import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  )
}

const DialogTrigger = BaseDialog.Trigger
const DialogBackdrop = BaseDialog.Backdrop

function DialogPortal({ children }: { children: React.ReactNode }) {
  return <BaseDialog.Portal>{children}</BaseDialog.Portal>
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>) {
  return (
    <DialogPortal>
      <DialogBackdrop
        className={cn(
          "fixed inset-0 z-50 bg-black/70 transition-opacity duration-150",
          "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        )}
      />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "max-h-[90vh] overflow-y-auto border border-border bg-card p-6 shadow-lg",
          "transition-opacity duration-150",
          "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          className
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </DialogPortal>
  )
}

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-left", className)}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      className={cn("text-lg font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  )
}
DialogTitle.displayName = "DialogTitle"

function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}
DialogDescription.displayName = "DialogDescription"

function DialogClose({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseDialog.Close>) {
  return (
    <BaseDialog.Close
      className={cn(
        "absolute right-4 top-4 p-1 text-muted-foreground transition-colors",
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none",
        className
      )}
      {...props}
    >
      {children ?? <X className="h-4 w-4" />}
      <span className="sr-only">Close</span>
    </BaseDialog.Close>
  )
}
DialogClose.displayName = "DialogClose"

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
}