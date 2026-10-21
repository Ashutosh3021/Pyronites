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
  'M86.1,50.6 L82,29 L127.6,13.4 L115.6,51.1 Z',
  'M119,55.9 L130.2,30.6 L176.8,50 L140.3,73.8 Z',
  'M143.7,77.6 L167.4,66.9 L192.9,110.2 L148.8,105.3 Z',
  'M148.6,111.9 L168.1,120.1 L164.4,167.3 L134.6,136.2 Z',
  'M126.1,137 L138.9,155.8 L107.8,187.7 L104,145.1 Z',
  'M96.9,144.7 L94.6,169.4 L47.4,176.9 L74.7,137 Z',
  'M64.7,134.9 L50.3,146.5 L9,123.8 L52,112.6 Z',
  'M48.7,105.7 L31.6,106.4 L19.7,57.4 L54.4,75.8 Z',
  'M62.9,74.6 L40.6,57.6 L63.4,14.1 L82.3,58.6 Z',
]

const CRACKS = [
  'M105.7,87.1 L125.5,33.7',
  'M112.4,93.4 L149.3,74.6',
  'M113.5,102 L156.4,111.4',
  'M110.7,111.8 L144.3,139.8',
  'M99.9,108.8 L104.6,169.1',
  'M91.9,109.4 L63.7,151.5',
  'M91.8,101.5 L29.9,109.9',
  'M86.6,91.1 L49.1,66.4',
  'M93.9,81.8 L75,17.9',
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
        <div className="core__halo" />
        <div className="core__heart" data-core-heart />
      </div>

      <svg className="core__plates" viewBox="0 0 200 200" fill="none" focusable="false">
        <defs>
          <linearGradient id="core-shard" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0%" stopColor="#2b1f16" />
            <stop offset="55%" stopColor="#1d1511" />
            <stop offset="100%" stopColor="#140f0c" />
          </linearGradient>
        </defs>

        <g className="core__shards">
          {SHARDS.map((d, i) => (
            <path key={i} d={d} fill="url(#core-shard)" stroke="rgba(255,106,0,0.16)" strokeWidth="0.8" />
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
