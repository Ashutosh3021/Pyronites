// Page transitions: the ignition.
//
// The product is a containment vessel. Leaving a page ignites from the centre
// of the screen — a hot disc that cools to basalt as it covers the view — and
// arriving on the next page lets the fire collapse back into the core.
//
// Kept short on purpose: this is an application, so the visitor should never
// wait more than about a second to change context.
import { gsap } from 'gsap';
import { ease, prefersReducedMotion } from './env';

export type Transition = {
  leave: (curtain: HTMLElement) => Promise<unknown> | gsap.core.Animation;
  enter: (curtain: HTMLElement) => Promise<unknown> | gsap.core.Animation;
};

const ignition: Transition = {
  leave: (c) =>
    gsap
      .timeline()
      .set(c, { autoAlpha: 1 })
      .fromTo(
        c.querySelector('.curtain__panel'),
        { clipPath: 'circle(0% at 50% 50%)' },
        { clipPath: 'circle(150% at 50% 50%)', duration: 0.5, ease: ease.inOut },
      ),
  enter: (c) =>
    gsap
      .timeline()
      .to(c.querySelector('.curtain__panel'), {
        clipPath: 'circle(0% at 50% 50%)',
        duration: 0.45,
        ease: ease.inOut,
      })
      .set(c, { autoAlpha: 0 }),
};

const reduced: Transition = {
  leave: (c) =>
    gsap.timeline().set(c, { autoAlpha: 1 }).fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.16 }),
  enter: (c) => gsap.to(c, { autoAlpha: 0, duration: 0.16 }),
};

let current: Transition = ignition;

export const setTransition = (t: Transition) => {
  current = t;
};
const pick = () => (prefersReducedMotion() ? reduced : current);
const curtain = () => document.getElementById('curtain') as HTMLElement;

export const playLeave = () => Promise.resolve(pick().leave(curtain()));
export const playEnter = () => Promise.resolve(pick().enter(curtain()));
