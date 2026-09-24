/* Liquid glass behaviour for theme.css:
   - the specular highlight on every glass surface follows the pointer
     (sets --mx / --my on the element under it);
   - segmented controls get a liquid bubble that slides to the chosen option.
   Both stand down under prefers-reduced-motion. */
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GLASS = ".lg, .lg-tint, .lg-dark, .btn";

  if (!reduce) {
    let frame = 0;
    let last = null;
    window.addEventListener(
      "pointermove",
      (e) => {
        last = e;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const el = last.target instanceof Element ? last.target.closest(GLASS) : null;
          if (!el) return;
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${last.clientX - r.left}px`);
          el.style.setProperty("--my", `${last.clientY - r.top}px`);
        });
      },
      { passive: true }
    );
  }

  function mountBubble(seg) {
    const bubble = document.createElement("span");
    bubble.className = "seg-bubble";
    bubble.setAttribute("aria-hidden", "true");
    seg.prepend(bubble);
    seg.classList.add("has-bubble");
    const place = () => {
      const on = seg.querySelector('button[aria-pressed="true"]');
      if (!on) return;
      bubble.style.width = `${on.offsetWidth}px`;
      bubble.style.height = `${on.offsetHeight}px`;
      bubble.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
    };
    new MutationObserver(place).observe(seg, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
    window.addEventListener("resize", place);
    document.fonts?.ready.then(place);
    place();
  }

  const start = () => document.querySelectorAll(".seg").forEach(mountBubble);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
