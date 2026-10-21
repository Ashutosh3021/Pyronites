export const prefersReducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isTouch = () => matchMedia('(hover: none), (pointer: coarse)').matches;

export const isMobile = () => matchMedia('(max-width: 767px)').matches;

/**
 * Shared easing vocabulary. One family, used everywhere.
 *
 * "Ignite and settle" — heat rises fast (expo.out), cools slow (power2.out).
 * Nothing springs: a backend dashboard should feel heavy, not bouncy.
 */
export const ease = {
  out: 'expo.out',
  inOut: 'expo.inOut',
  soft: 'power3.out',
  settle: 'power2.out',
} as const;
