/**
 * The mark: a fractured shell around a hot centre, reduced to three shards and
 * three seams. It is the smallest honest piece of the concept, the same
 * drawing the overview uses at rail size.
 */
export function CoreMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <circle cx="100" cy="100" r="62" fill="#221710" />
      <path
        d="M86.1,50.6 L82,29 L127.6,13.4 L115.6,51.1 Z"
        fill="#2b1f16"
        stroke="rgba(255,106,0,0.35)"
        strokeWidth="2"
      />
      <path
        d="M148.6,111.9 L168.1,120.1 L164.4,167.3 L134.6,136.2 Z"
        fill="#2b1f16"
        stroke="rgba(255,106,0,0.35)"
        strokeWidth="2"
      />
      <path
        d="M62.9,74.6 L40.6,57.6 L63.4,14.1 L82.3,58.6 Z"
        fill="#2b1f16"
        stroke="rgba(255,106,0,0.35)"
        strokeWidth="2"
      />
      <path d="M105.7,87.1 L125.5,33.7" stroke="#ffb15c" strokeWidth="5" strokeLinecap="round" />
      <path d="M99.9,108.8 L104.6,169.1" stroke="#ff6a00" strokeWidth="5" strokeLinecap="round" />
      <path d="M91.8,101.5 L29.9,109.9" stroke="#ffd9a0" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
