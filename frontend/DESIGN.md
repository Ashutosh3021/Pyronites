# PyroCore UI — design system

Scope: the `frontend/` dashboard only. No backend change is part of this work.

## Brief

| | |
|---|---|
| Subject | PyroCore / Pyronites — a self-hosted backend (FastAPI + SQLite) with a dashboard |
| Audience | Developers who run their own backend; they arrive from a terminal, not a marketing page |
| The site's job | Make the state of a running backend legible in under three seconds, and let a developer act on it (tables, SQL, keys, storage, logs, backups) without hunting |
| Language | English |
| Assets | None provided. No photography in this product: the imagery is data, and the signature is drawn, not photographed |
| Constraints | Keep the brand orange `#ff6a00`. Keep radius ≤ 1px. Keep the sharp, angular look. Tailwind v4, CSS-first, no `tailwind.config.js`. Errors go through `components/alert-banner.tsx` only |

## Concept

The product's own name is the idea. A **pyronite** is a plasma body trapped under cooled
volcanic rock: the surface is dead basalt, and every bit of heat lives in the cracks.

PyroCore is therefore drawn as a **containment vessel**. The dashboard is the inside of a cooled
shell:

- the **shell** is structure: navigation, settings, forms, tables — cooled basalt plates, matte, hairlined
- the **core** is live state: request rate, logs, latency — plasma seen through the cracks, the only place colour is allowed to glow
- the **seam** is the interface: the hairline where two plates meet. Colour only ever appears in a seam

### Concept card

```
Idea:        PyroCore is a containment vessel: a cooled basalt shell around a live plasma core,
             and every panel is a plate you read that core through.
Metaphor:    Heatblast's body — plasma under volcanic rock, fire only in the cracks.
Signature:   The Core — a fractured basalt disc with a plasma heart on the overview. Its heat is
             the backend's real request rate; heat runs out from it along the plate seams.
             (recipe: driver module + inline SVG, motion.md "driver module")
Emotion:     Standing inside a machine that is alive and running hot.
Motion verb: "ignite and settle" — heat rises fast and cools slow. Nothing bounces, nothing springs.
Screenshot:  The Core: fractured plates, molten seams, a white-hot centre, tabular readouts beside it.
```

### Alternatives considered

| Concept | Territory | Why not |
|---|---|---|
| **Pyros Observatory** — the dashboard reads like a star's surface, corona reacting to traffic | Place: the star Pyros | Drifts into generic sci-fi; nothing in the UI is a star |
| **The Thermal Ledger** — every request is heat in, every response is heat out; a heat-ledger strip chart | Metaphor for how the backend works | Honest but abstract; the abstraction costs the visitor more than the metaphor returns |

### Genericness test

A generic model given "redesign a backend dashboard with a Heatblast reference" produces: dark
surface, orange glow, a gradient blob in the hero, glassy cards. Changed here:

- the glow is **not** a blob. It is a drawn, fractured core whose light comes out of seams
- cards are not soft-shadowed glass. They are **plates**: matte basalt, 1px seam, 0px radius
- colour is rationed: the accent only appears in seams, the core, and one treatment per interactive role
- the hero is **not** a centred title over a gradient. It is an asymmetric band: core on one side, real numbers on the other

## System

### Palette (by role)

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#0c0a09` | the void inside the vessel; page background |
| `--plate` | `#131110` | basalt plate: cards, panels, tables |
| `--plate-raised` | `#1a1715` | raised plate: inputs, hover rows, menus |
| `--ink` | `#f4efe9` | ash: primary text |
| `--ink-muted` | `#a1968c` | cooled ash: secondary text (6.7:1 on ground) |
| `--ink-faint` | `#857a70` | meta labels (4.7:1 on ground, AA) |
| `--seam` | `rgba(244,239,233,0.09)` | hairline between plates |
| `--seam-strong` | `rgba(244,239,233,0.16)` | hairline on hover / focus |
| `--accent` | `#ff6a00` | brand orange: the only saturated colour in the chrome |
| `--hot` | `#ffd9a0` | white-hot centre of the plasma |
| `--magma` | `#b32a05` | deep ember, the cooled edge of the core |
| `--curtain` | `#0c0a09` | page transition cover |

Semantic: `--success #22c55e`, `--warning #eab308`, `--error #ef4444`, `--info #3b82f6`.
Charts: `--chart-1 #ff6a00`, `--chart-2 #22c55e`, `--chart-3 #60a5fa`, `--chart-4 #eab308`, `--chart-5 #ef4444`.

### Type

| Role | Family | Source | Setting |
|---|---|---|---|
| Display | **Archivo** variable | Google, via `next/font` | 700–800, `wght 750`, `wdth` 62–125. Tracking −0.03em at display sizes, −0.015em at UI sizes. Uppercase only for the wordmark and section labels |
| UI + body | **Archivo** variable | same family | 400–500, 15–17px, leading 1.5 |
| Data | **JetBrains Mono** | Google, via `next/font` | tabular numerals for every number, id, timestamp, SQL, log level |

Archivo's `wdth` axis is the concept's one typographic move: **heat expands type**. The core's
readout and the wordmark breathe between `wdth 92` and `wdth 108`. Nothing else animates width.

### Grid & rhythm

- Fixed 264px rail on ≥1024px; below that a full-height drawer.
- Content column: `max-width: 1440px`, gutter `clamp(20px, 4vw, 48px)`.
- 12 columns inside the content column; text hangs from column 1, 5 and 9.
- Section rhythm varies on purpose: hero band airy (96px), stat strip tight (28px), content sections 64px, tables 40px.

### Shape

Radius 0. `--radius-max: 1px` (repo rule). Angularity comes from **hairline seams and clipped
corners on non-interactive graphics**, not from radius: the core plate and the hero band use a
10px 45° chamfer. Interactive elements keep square corners so focus rings are never clipped.

### Motion

| Thing | Duration | Ease |
|---|---|---|
| Hover / press | 0.25s | `power3.out` |
| Reveal | 0.7s, stagger 0.06s | `expo.out` |
| Page transition | 0.75s each way | `expo.inOut` |
| Core breath (idle) | 4.2s loop | `sine.inOut` |

One clock: everything runs on GSAP's ticker. No `scroll` listeners, no `requestAnimationFrame`
loops of our own. **Lenis is used** for smooth scroll on the document scroller.

### The signature: The Core

An inline SVG of fractured basalt plates around a plasma heart. Its heat is the backend's **real**
request rate, read from `GET /api/projects/{id}/metrics?range=1h`. One driver variable
(`heat`, 0–1) fans out to: plasma radius, glow intensity, crack brightness, the core's readout,
and the warmth of the seam under the page title. Idle input: a slow breath on the ticker plus a
lagged pointer influence, so the core answers the pointer before any scroll.

### Motion treatments, one per role

| Role | Treatment |
|---|---|
| Primary button (CTA) | **Ignites from the bottom edge**: an orange fill rises (`clip-path: inset(100% 0 0 0)` → `inset(0)`), text goes dark. Works on `:active` for touch |
| Nav item | The left seam opens from the centre outward on hover; the active page keeps its seam lit |
| Row / table item | The left seam lights to the row's level colour and the plate warms one step |
| Tab | The underline seam draws from the left |
| Inline link in text | Underline at rest, rises into a band on hover |
| Utility link (terms, privacy, logout) | Colour change only |

### Deliberate omissions

- **No loader.** This is an application. Delaying a dashboard by 1–2.6s to stage a reveal costs
  Usability and buys nothing the entrance transition does not already buy.
- **No WebGL.** The core is drawn in SVG. A shader here would be decoration on top of a data
  product, and would put a phone-sized GPU bill on a page whose job is to be read.
- **No cursor follower.** A dashboard is a tool; the pointer should point at rows.
- **No glassmorphism, no soft shadows.** Matte plates and hairlines are the material.
