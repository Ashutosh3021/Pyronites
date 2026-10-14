"use client"

/**
 * Select primitives on Base UI.
 *
 * The previous hand-rolled version closed by rendering `null` and handled
 * selection with `onClick` on a plain `<div>` — so the list was not reachable
 * by keyboard at all, had no combobox roles, no typeahead and no arrow-key
 * navigation. Base UI supplies all of that.
 *
 * Exported names and props are unchanged, so existing call sites still compile.
 */

import * as React from "react"
import { Select as BaseSelect } from "@base-ui/react/select"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Carries the selected value down to SelectValue.
 *
 * Base UI can render the selected label itself, but only when Root receives an
 * `items` array, which our call sites do not pass. Keeping our own context
 * preserves the previous behaviour (echo the raw value) without changing any
 * caller.
 */
const SelectCtx = React.createContext<{ value?: string | null }>({ value: null })

function Select({
  value,
  onValueChange,
  children,
  disabled,
}: {
  value?: string | null
  onValueChange?: (value: string) => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <SelectCtx.Provider value={{ value }}>
      <BaseSelect.Root
        value={value ?? null}
        onValueChange={(next) => {
          if (next != null) onValueChange?.(String(next))
        }}
        disabled={disabled}
      >
        {children}
      </BaseSelect.Root>
    </SelectCtx.Provider>
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap",
        "border border-input bg-transparent px-3 py-2 text-sm text-foreground",
        "transition-colors hover:bg-muted focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value } = React.useContext(SelectCtx)
  return <span className="font-mono text-xs">{value || placeholder || "Select…"}</span>
}

function SelectContent({
  children,
  className,
  align = "start",
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Popup> & {
  align?: "start" | "center" | "end"
}) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner align={align} sideOffset={4} className="z-50">
        <BaseSelect.Popup
          className={cn(
            "max-h-72 min-w-[8rem] overflow-hidden border border-border bg-popover shadow-lg",
            "transition-opacity duration-100",
            "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            className
          )}
          {...props}
        >
          <BaseSelect.List className="max-h-72 overflow-y-auto p-1">{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

function SelectItem({
  value,
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      value={value}
      className={cn(
        "relative flex cursor-default select-none items-center justify-between gap-2",
        "px-2 py-1.5 text-xs text-foreground outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[selected]:font-semibold",
        className
      )}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator>
        <Check className="h-3.5 w-3.5" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
}