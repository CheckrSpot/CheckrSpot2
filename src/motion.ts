// Timing shared by the editor's animations. SLIDE_MS matches the
// transitions in style.css.
export const SLIDE_MS = 300;

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run `fn` once a slide or collapse transition has finished. */
export const afterSlide = (fn: () => void) => setTimeout(fn, reducedMotion() ? 0 : SLIDE_MS);

// Each element's latest expand() call, so an earlier one's timer, still
// pending, doesn't undo it.
const latest = new WeakMap<HTMLElement, number>();

/** Expand `el` from zero height to its natural height, or collapse it and then hide it. */
export function expand(el: HTMLElement, open: boolean) {
  const call = (latest.get(el) ?? 0) + 1;
  latest.set(el, call);
  if (open) {
    // From zero, or from part way if it was still collapsing.
    const from = el.hidden ? 0 : el.offsetHeight;
    el.hidden = false;
    el.style.height = `${from}px`;
    void el.offsetHeight;
    el.style.height = `${el.scrollHeight}px`;
  } else {
    el.style.height = `${el.offsetHeight}px`;
    void el.offsetHeight;
    el.style.height = '0px';
  }
  afterSlide(() => {
    if (latest.get(el) !== call) return;
    if (open) el.style.height = '';
    else el.hidden = true;
  });
}
