'use client'

/**
 * The Core — the signature element.
 *
 * A shell of fractured basalt plates around a plasma heart. The heat is real:
 * the driver in `motion/core.ts` reads the backend's actual request rate and
 * writes `--core-heat`, from which the plasma, the cracks and the halo all
 * derive. The drawing itself carries no meaning for a screen reader, so it is
 * hidden and the numbers beside it do the talking.
 */

const SHARDS = [
  'M91.7,71.9 L82.7,33.9 L128.3,13.9 L109.1,72.1 Z',
  'M114.1,70.9 L126.1,52.9 L176.1,60.8 L128.7,85.2 Z',
  'M129.8,91.1 L151.4,87 L186.9,123 L130,108 Z',
  'M128.5,114.6 L153.4,130.7 L138.9,181 L113.9,128.9 Z',
  'M108.9,129.3 L115.7,159.9 L76.8,185.4 L92,129.6 Z',
  'M84.4,131.1 L73.7,144.5 L17.4,139.5 L68.6,115 Z',
  'M72.1,108.2 L49.6,114.3 L16.5,73.5 L72.3,91.2 Z',
  'M69.8,83.9 L57.5,76.3 L57,23.3 L83.2,70.2 Z',
]

const CRACKS = [
  'M119.7,59.1 L92.9,58.0',
  'M47.1,113.3 L55.7,124.9',
  'M121.8,146.5 L139.8,131.0',
  'M114.7,173.5 L105.8,193.6',
  'M112.8,140.5 L124.7,158.6',
  'M151.8,109.1 L148.0,122.6',
  'M119.7,36.6 L134.2,40.7',
  'M177.9,106.1 L182.9,117.4',
  'M67.2,140.2 L79.6,139.9',
  'M86.9,54.8 L97.1,61.0',
  'M134.0,47.7 L147.3,33.8',
]

export function Core({ size = 260, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={`core ${className}`}
      style={{ width: size, height: size }}
      data-core
      aria-hidden="true"
    >
      <div className="core__plasma" data-core-plasma>
        <div className="core__breath">
          <div className="core__halo" />
          <div className="core__heart" data-core-heart />
        </div>
      </div>

      <svg className="core__plates" viewBox="0 0 200 200" fill="none" focusable="false">
        <defs>
          <radialGradient id="core-shard" cx="0.4" cy="0.25" r="0.9">
            <stop offset="0%" stopColor="#2e2118" />
            <stop offset="55%" stopColor="#1d1511" />
            <stop offset="100%" stopColor="#120d0a" />
          </radialGradient>
          <radialGradient id="core-core" cx="0.5" cy="0.46" r="0.55">
            <stop offset="0%" stopColor="#fff1d8" />
            <stop offset="22%" stopColor="#ffb15c" />
            <stop offset="52%" stopColor="#ff6a00" />
            <stop offset="78%" stopColor="#b32a05" />
            <stop offset="100%" stopColor="#3a1204" />
          </radialGradient>
        </defs>

        {/* The heart, seen through the gap the plates leave in the middle. */}
        <circle cx="100" cy="100" r="30" fill="url(#core-core)" opacity="0.92" />

        <g className="core__shards">
          {SHARDS.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="url(#core-shard)"
              stroke="rgba(255,106,0,0.22)"
              strokeWidth="0.7"
            />
          ))}
        </g>

        <g className="core__cracks" data-core-cracks>
          {CRACKS.map((d, i) => (
            <path key={i} d={d} className="core__crack-glow" />
          ))}
          {CRACKS.map((d, i) => (
            <path key={i} d={d} className="core__crack" />
          ))}
        </g>
      </svg>

      <div className="core__ring" />
    </div>
  )
}
