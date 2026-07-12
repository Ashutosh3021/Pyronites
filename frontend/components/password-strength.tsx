/**
 * Reusable password strength indicator.
 * 4-segment bar: error → warning → success
 * Shared between Sign Up and the wizard's admin password step.
 */

export function getPasswordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0
  let score = 0
  if (password.length >= 8)  score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  // Clamp to 4 segments
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4
}

const LABELS: Record<number, string> = {
  0: '',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Very strong',
}

// Segment fill colours keyed by overall strength
const SEGMENT_COLOR = (strength: number, segIdx: number): string => {
  if (segIdx >= strength) return 'var(--border)' // unfilled
  if (strength <= 1) return 'var(--error)'
  if (strength === 2) return 'var(--warning)'
  return 'var(--success)'
}

interface PasswordStrengthProps {
  password: string
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const strength = getPasswordStrength(password)

  if (!password) return null

  return (
    <div className="mt-2 space-y-1">
      {/* 4-segment bar */}
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 transition-colors duration-200"
            style={{ backgroundColor: SEGMENT_COLOR(strength, i) }}
          />
        ))}
      </div>
      {/* Label */}
      <p
        className="text-xs"
        style={{
          color:
            strength <= 1 ? 'var(--error)'
            : strength === 2 ? 'var(--warning)'
            : 'var(--success)',
        }}
      >
        {LABELS[strength]}
      </p>
    </div>
  )
}
