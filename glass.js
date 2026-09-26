/* Segmented controls (theme.css .seg): a knob that slides to the option you
   pick. It moves only when you click; reduced motion drops the slide (CSS). */
(() => {
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
