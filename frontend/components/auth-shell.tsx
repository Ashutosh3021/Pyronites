/**
 * Shared wrapper for all pre-dashboard auth/onboarding screens.
 * Plain background, centered card — no hero treatment.
 */

interface AuthShellProps {
  children: React.ReactNode
  /** Card width — 'sm' = ~400px (login/signup), 'md' = ~560px (wizard) */
  width?: 'sm' | 'md'
}

export function AuthShell({ children, width = 'sm' }: AuthShellProps) {
  const maxW = width === 'md' ? 'max-w-[560px]' : 'max-w-[400px]'
  return (
    <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className={`w-full ${maxW} bg-card border border-border`}>
        {children}
      </div>
    </div>
  )
}
