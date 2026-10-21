// Declarative motion through data attributes.
//
//   data-split="lines|words|chars"  masked text reveal (SplitText)
//   data-reveal="up|fade|clip|scale" block reveal
//   data-intro                      play with the page intro instead of on scroll
//   data-delay="0.2"                extra delay (seconds)
//
// Every effect is skipped under reduced motion; CSS keeps content visible without JS.
//
// NOTE for this product: the dashboard's LCP text must never be hidden before
// reveal. Only use data-split / data-reveal on content that lives below the
// first screen. The hero uses the Core's own ignition instead.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { ease, prefersReducedMotion } from './env';

gsap.registerPlugin(ScrollTrigger, SplitText);

const durations = { lines: 0.8, words: 0.7, chars: 0.6 } as const;
const staggers = { lines: 0.06, words: 0.03, chars: 0.015 } as const;

function splitTween(el: HTMLElement, isIntro: boolean) {
  const type = (el.dataset.split || 'lines') as keyof typeof durations;
  const delay = parseFloat(el.dataset.delay || '0');
  const s = { tween: undefined as gsap.core.Tween | undefined, done: false, requested: false };
  SplitText.create(el, {
    type: type === 'lines' ? 'lines' : `lines,${type}`,
    mask: 'lines',
    autoSplit: true,
    linesClass: 'split-line',
    onSplit(self) {
      gsap.set(el, { visibility: 'visible' });
      if (s.done) return;
      const targets = type === 'lines' ? self.lines : type === 'words' ? self.words : self.chars;
      s.tween = gsap.from(targets, {
        yPercent: 108,
        rotate: type === 'chars' ? 0 : 1.5,
        duration: durations[type],
        stagger: staggers[type],
        ease: ease.out,
        delay,
        paused: isIntro && !s.requested,
        onComplete: () => {
          s.done = true;
        },
        scrollTrigger: isIntro ? undefined : { trigger: el, start: 'top 92%', once: true },
      });
      return s.tween;
    },
  });
  return () => {
    s.requested = true;
    s.tween?.play();
  };
}

function blockTween(el: HTMLElement, paused: boolean) {
  const kind = el.dataset.reveal || 'up';
  const delay = parseFloat(el.dataset.delay || '0');
  const from: gsap.TweenVars =
    kind === 'fade'
      ? { autoAlpha: 0 }
      : kind === 'clip'
        ? { clipPath: 'inset(100% 0% 0% 0%)', autoAlpha: 1 }
        : kind === 'scale'
          ? { scale: 1.06, clipPath: 'inset(8% 8% 8% 8%)', autoAlpha: 1 }
          : { y: 26, autoAlpha: 0 };
  const to: gsap.TweenVars =
    kind === 'clip' || kind === 'scale' ? { clipPath: 'inset(0% 0% 0% 0%)', scale: 1 } : {};
  gsap.set(el, { visibility: 'visible' });
  return gsap.fromTo(
    el,
    from,
    {
      ...to,
      y: 0,
      autoAlpha: 1,
      duration: kind === 'fade' ? 0.6 : 0.75,
      ease: ease.out,
      delay,
      paused,
      scrollTrigger: paused ? undefined : { trigger: el, start: 'top 94%', once: true },
    },
  );
}

/** Wire every reveal inside `root`. Returns the intro timeline (paused) for the page entrance. */
export function initReveals(root: ParentNode = document) {
  const intro = gsap.timeline({ paused: true });
  if (prefersReducedMotion()) return intro;

  root.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    const isIntro = el.hasAttribute('data-intro');
    const play = splitTween(el, isIntro);
    if (isIntro) intro.add(play, 0);
  });
  root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    const isIntro = el.hasAttribute('data-intro');
    const t = blockTween(el, isIntro);
    if (isIntro) intro.add(() => t.play(), 0);
  });
  return intro;
}
