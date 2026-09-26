/* The pipeline demo: one sentence through record → hints → transcribe →
   Memory swaps → polish → paste → learn, for Whisper or Parakeet, before and
   after Memory has learned your fixes. The transcripts are real outputs from
   the local engines (whisper.cpp ggml-base, sherpa-onnx Parakeet TDT 0.6B v3)
   on macOS `say` audio of: "Please deploy the dashboard to Supabase and ping
   Kubernetes on Vercel."

   Markup: any element with [data-pipeline] containing
   [data-seg="engine"], [data-seg="mem"] (button groups with data-v) and
   [data-stages]. */
(() => {
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const DATA = {
    whisper: {
      new: {
        hints: { text: "Nothing to suggest yet: Memory is empty and Word Packs are off.", tag: ["no", "no hints"] },
        stt: { text: "Please deploy the dashboard to Superbase and ping Cuberniz on Vercel.", bad: ["Superbase", "Cuberniz"] },
        swap: { text: "Nothing to swap yet.", tag: ["no", "no rules"] },
        fix: "You fix “Superbase” → Supabase and “Cuberniz” → Kubernetes. Memory now knows both words, and both go into your Dictionary.",
      },
      learned: {
        hints: { text: "The prompt now ends with … Kubernetes, Supabase", tag: ["memory", "your words, last"] },
        stt: { text: "Please deploy the dashboard to Supabase and ping Kubernetes on Varsal.", good: ["Supabase", "Kubernetes"], bad: ["Varsal"] },
        swap: { text: "Nothing left to swap: Whisper already wrote them right.", tag: ["good", "hints did it"] },
        fix: "Hints aren't magic: this run turned “Vercel” into “Varsal”. Fix it and Memory learns that word too.",
      },
    },
    parakeet: {
      new: {
        hints: { text: "Parakeet has no prompt input, so there's nothing to send.", tag: ["no", "not possible"] },
        stt: { text: "Please deploy the dashboard to Superbase and ping Kubernetes on Versailles.", bad: ["Superbase", "Versailles"] },
        swap: { text: "Nothing to swap yet.", tag: ["no", "no rules"] },
        fix: "You fix “Superbase” → Supabase. Make the same fix twice and Memory asks: “Always change Superbase to Supabase?”",
      },
      learned: {
        hints: { text: "Still nothing: Parakeet can't take hints, even though Memory knows your words.", tag: ["no", "not possible"] },
        stt: { text: "Please deploy the dashboard to Superbase and ping Kubernetes on Versailles.", bad: ["Superbase", "Versailles"] },
        swap: {
          text: "Please deploy the dashboard to Supabase and ping Kubernetes on Versailles.",
          good: ["Supabase"], bad: ["Versailles"], tag: ["good", "Memory swap"],
        },
        fix: "Measured: you said “Always” when Memory asked, and Parakeet's next transcript comes out as “Supabase”.",
      },
    },
  };

  const highlight = (x) =>
    [["bad", x.bad || []], ["fix", x.good || []]].reduce(
      (html, [cls, words]) =>
        words.reduce((t, w) => t.split(esc(w)).join(`<mark class="${cls}">${esc(w)}</mark>`), html),
      esc(x.text)
    );
  const utter = (x) => `<div class="utter">${highlight(x)}</div>`;
  const tag = (t) => (t ? ` <span class="tag ${t[0]}">${esc(t[1])}</span>` : "");
  const note = (t) => `<p class="note">${esc(t)}</p>`;

  function render(stagesEl, engine, mem) {
    const d = DATA[engine][mem];
    const pasted = d.swap.good ? d.swap : d.stt;
    const stages = [
      ["Record", "The mic captures your voice. No words yet, just sound.", ""],
      ["Word hints", "Your Memory, Dictionary and Word Pack words are packed into a prompt, if the engine accepts one." + tag(d.hints.tag), note(d.hints.text)],
      ["Transcribe", "The speech model turns sound into text.", utter(d.stt)],
      ["Memory swaps", "Mishearings you've approved are replaced with your spelling." + tag(d.swap.tag), d.swap.good ? utter(d.swap) : note(d.swap.text)],
      ["Polish", "A small local language model tidies punctuation and filler words. It sees your Dictionary, and never translates.", ""],
      ["Paste", "The text lands at your cursor, in the app you were using.", utter(pasted)],
      ["Learn from your fix", "Edit the pasted text and Memory compares, then learns.", note(d.fix)],
    ];
    stagesEl.innerHTML = stages
      .map(
        ([h, what, body], i) =>
          `<div class="stage"><div class="rail"><span class="dot">${i + 1}</span></div>` +
          `<div class="body"><h3>${h}</h3><p class="note">${what}</p>${body}</div></div>`
      )
      .join("");
  }

  function mount(root) {
    const engineSeg = root.querySelector('[data-seg="engine"]');
    const memSeg = root.querySelector('[data-seg="mem"]');
    const stagesEl = root.querySelector("[data-stages]");
    const value = (seg) => seg.querySelector('button[aria-pressed="true"]').dataset.v;
    const update = () => render(stagesEl, value(engineSeg), value(memSeg));
    [engineSeg, memSeg].forEach((seg) =>
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]");
        if (!b) return;
        seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        update();
      })
    );
    update();
  }

  document.querySelectorAll("[data-pipeline]").forEach(mount);
})();
