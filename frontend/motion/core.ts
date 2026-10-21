import { gsap } from 'gsap';
import { onPage, prefersReducedMotion, isTouch } from '@/engine';

/**
 * The driver.
 *
 * One variable carries the concept: `heat`, 0 to 1, derived from the backend's
 * real request rate. Everything that glows in PyroCore reads from it, so the
 * plasma, the cracks, the halo and the lit seam under the header can never
 * disagree about how hot the machine is.
 *
 * The value is written to `--core-heat` only when the data changes, which is
 * once every poll. Writing a custom property on the root invalidates the
 * styles of everything that reads it, so doing it per frame would cost a
 * phone its frame rate. The slow breath that keeps the vessel alive is a CSS
 * keyframe on the plasma's own layer, where the compositor handles it without
 * touching the main thread.
 */

type Bindings = {
  plasma: HTMLElement | null;
  heart: HTMLElement | null;
  rates: HTMLElement[];
  states: HTMLElement[];
};

const bindings: Bindings = { plasma: null, heart: null, rates: [], states: [] };

const state = { heat: 0, rate: 0 };
let heatTween: gsap.core.Tween | null = null;
const pointer = { x: 0, y: 0 };
const aim = { x: 0, y: 0 };
let pointerTicker: ((time: number) => void) | null = null;

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
    paintHeat();
  } else {
    heatTween = gsap.to(state, {
      heat,
      duration: 0.9,
      ease: 'power2.out',
      onUpdate: paintHeat,
    });
  }

  const word = coreState(state.rate);
  bindings.rates.forEach((el) => {
    el.textContent = String(state.rate);
  });
  bindings.states.forEach((el) => {
    el.textContent = word;
  });
}

export function coreState(rate: number) {
  if (rate <= 0) return 'IDLE';
  if (rate < 10) return 'WARM';
  if (rate < FULL_HEAT_RPM) return 'ACTIVE';
  return 'HOT';
}

function paintHeat() {
  const heat = clamp01(state.heat);
  // Written on the root so every consumer agrees: the plasma, the cracks, the
  // halo, and the lit seam under the header all read the same number.
  document.documentElement.style.setProperty('--core-heat', heat.toFixed(3));

  if (bindings.plasma) {
    gsap.set(bindings.plasma, {
      scale: 0.9 + heat * 0.22,
      opacity: 0.6 + heat * 0.4,
    });
  }
  if (bindings.heart) {
    gsap.set(bindings.heart, { scale: 0.94 + heat * 0.14 });
  }
}

/** The pointer nudges the plasma. It only runs while the pointer is moving. */
function tickPointer() {
  const k = 0.12;
  const dx = aim.x - pointer.x;
  const dy = aim.y - pointer.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    stopPointerTicker();
    return;
  }
  pointer.x += dx * k;
  pointer.y += dy * k;
  if (bindings.plasma) {
    gsap.set(bindings.plasma, {
      x: pointer.x * 6,
      y: pointer.y * 6,
    });
  }
}

function startPointerTicker() {
  if (pointerTicker || prefersReducedMotion()) return;
  pointerTicker = tickPointer;
  gsap.ticker.add(pointerTicker);
}

function stopPointerTicker() {
  if (!pointerTicker) return;
  gsap.ticker.remove(pointerTicker);
  pointerTicker = null;
}

export function startCore() {
  if (!isTouch()) {
    addEventListener(
      'pointermove',
      (e) => {
        aim.x = e.clientX / innerWidth - 0.5;
        aim.y = e.clientY / innerHeight - 0.5;
        startPointerTicker();
      },
      { passive: true },
    );
  }

  onPage(() => {
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

    paintHeat();

    return () => {
      bindings.rates = [];
      bindings.states = [];
      bindings.plasma = null;
      bindings.heart = null;
    };
  });
}
