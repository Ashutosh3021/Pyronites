"use client"

/**
 * Tabs primitives on Base UI.
 *
 * The previous version was a controlled/uncontrolled hybrid that rendered tab
 * panels by hand with no ARIA: no `role="tablist"`/`tab`/`tabpanel`, no
 * `aria-selected`, no `aria-controls`, and no arrow-key roving focus. A screen
 * reader had no way to know what was selected or what a tab would reveal.
 *
 * Base UI wires all of that up. Exported names and props are unchanged.
 */

import * as React from "react"
import { Tabs as BaseTabs } from "@base-ui/react/tabs"
import { cn } from "@/lib/utils"

function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <BaseTabs.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (next != null) onValueChange?.(String(next))
      }}
    >
      {children}
    </BaseTabs.Root>
  )
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1 bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </BaseTabs.List>
  )
}

function TabsTrigger({
  value,
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      value={value}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap px-3 py-1 text-sm font-medium",
        "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "text-muted-foreground hover:text-foreground",
        "data-[selected]:bg-background data-[selected]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </BaseTabs.Tab>
  )
}

function TabsContent({
  value,
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>) {
  return (
    <BaseTabs.Panel value={value} className={cn("mt-3 outline-none", className)} {...props}>
      {children}
    </BaseTabs.Panel>
  )
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
}