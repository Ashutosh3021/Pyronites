import { gsap } from 'gsap';
import { onPage, prefersReducedMotion, isTouch } from '@/engine';

/**
 * The driver.
 *
 * One variable carries the concept: `heat`, 0 to 1, derived from the backend's
 * real request rate. Everything that glows in PyroCore reads from it, so the
 * plasma, the cracks, the halo, the plate seams and the readout can never
 * disagree about how hot the machine is.
 *
 * The idle input is a slow breath plus a lagged pointer influence: the core
 * answers the pointer before anyone scrolls, and keeps breathing when nobody
 * touches anything.
 */

type Bindings = {
  root: HTMLElement | null;
  plasma: HTMLElement | null;
  heart: HTMLElement | null;
  rates: HTMLElement[];
  states: HTMLElement[];
};

const bindings: Bindings = { root: null, plasma: null, heart: null, rates: [], states: [] };

const state = { heat: 0, breath: 0, rate: 0 };
let heatTween: gsap.core.Tween | null = null;
let pointer = { x: 0, y: 0 };
let aim = { x: 0, y: 0 };
let tickerAttached = false;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Requests per minute that count as a fully lit core. */
const FULL_HEAT_RPM = 45;

/**
 * Report the backend's current request rate. Called by the page that owns the
 * data, so the number on screen is always the number the server measured.
 */
export function reportCoreRate(requestsPerMinute: number) {
  state.rate = Math.max(0, Math.round(requestsPerMinute));
  const heat = clamp01(state.rate / FULL_HEAT_RPM);

  heatTween?.kill();
  if (prefersReducedMotion()) {
    state.heat = heat;
    paint();
  } else {
    heatTween = gsap.to(state, {
      heat,
      duration: 0.9,
      ease: 'power2.out',
      onUpdate: paint,
    });
  }

  if (bindings.rates.length) {
    bindings.rates.forEach((el) => {
      el.textContent = String(state.rate);
    });
  }
  if (bindings.states.length) {
    const word = coreState(state.rate);
    bindings.states.forEach((el) => {
      el.textContent = word;
    });
  }
}

export function coreState(rate: number) {
  if (rate <= 0) return 'IDLE';
  if (rate < 10) return 'WARM';
  if (rate < FULL_HEAT_RPM) return 'ACTIVE';
  return 'HOT';
}

function paint() {
  const total = clamp01(state.heat * 0.86 + state.breath * 0.14);
  const root = bindings.root ?? document.documentElement;
  root.style.setProperty?.('--core-heat', total.toFixed(3));

  if (bindings.plasma) {
    gsap.set(bindings.plasma, {
      scale: 0.86 + total * 0.26 + pointer.x * 0.015,
      opacity: 0.55 + total * 0.45,
      x: pointer.x * 5,
      y: pointer.y * 5,
    });
  }
  if (bindings.heart) {
    gsap.set(bindings.heart, { scale: 0.94 + total * 0.14 });
  }
}

function tick(time: number) {
  // A slow breath: ~4.2s per cycle. Small enough to be ambient, never a show.
  const breath = (Math.sin(time * 1.5) + 1) / 2;
  const next = Math.round(breath * 100) / 100;
  if (next === state.breath) return;
  state.breath = next;

  // Lagged pointer influence.
  const k = 0.08;
  pointer.x += (aim.x - pointer.x) * k;
  pointer.y += (aim.y - pointer.y) * k;

  paint();
}

function attachTicker() {
  if (tickerAttached || prefersReducedMotion()) return;
  tickerAttached = true;
  gsap.ticker.add(tick);
}

function detachTicker() {
  if (!tickerAttached) return;
  tickerAttached = false;
  gsap.ticker.remove(tick);
}

export function startCore() {
  if (!isTouch()) {
    addEventListener(
      'pointermove',
      (e) => {
        aim.x = e.clientX / innerWidth - 0.5;
        aim.y = e.clientY / innerHeight - 0.5;
      },
      { passive: true },
    );
  }

  onPage(() => {
    bindings.root = document.querySelector<HTMLElement>('[data-core]');
    bindings.plasma = document.querySelector<HTMLElement>('[data-core-plasma]');
    bindings.heart = document.querySelector<HTMLElement>('[data-core-heart]');
    bindings.rates = Array.from(document.querySelectorAll<HTMLElement>('[data-core-rate]'));
    bindings.states = Array.from(document.querySelectorAll<HTMLElement>('[data-core-state]'));

    // Re-apply the last known reading to the elements of this page.
    bindings.rates.forEach((el) => {
      el.textContent = String(state.rate);
    });
    const word = coreState(state.rate);
    bindings.states.forEach((el) => {
      el.textContent = word;
    });

    paint();

    // Pause the breath when the core is off screen: an idle animation nobody
    // can see is still work.
    const root = bindings.root;
    if (root && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        ([entry]) => (entry.isIntersecting ? attachTicker() : detachTicker()),
        { threshold: 0 },
      );
      io.observe(root);
      return () => {
        io.disconnect();
        detachTicker();
      };
    }
    attachTicker();
    return () => detachTicker();
  });
}
