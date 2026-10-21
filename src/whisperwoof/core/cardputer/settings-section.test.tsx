/**
 * Settings → WhisperWoof → Cardputer recordings (ui/settings/CardputerSection.tsx),
 * rendered without a DOM: before main answers, the switch is off and can't be
 * used, and the section says the folder holds plain files.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardputerSection from "../../ui/settings/CardputerSection";

describe("Settings: Cardputer recordings", () => {
  it("shows the switch off and disabled until main answers, the folder buttons and the plain-files note", () => {
    const html = renderToStaticMarkup(createElement(CardputerSection));
    expect(html).toContain("Cardputer recordings");
    expect(html).toContain("Transcribe Cardputer recordings");
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*disabled/);
    expect(html).toContain("Change Folder");
    expect(html).toContain("Loading...");
    expect(html).toContain("encryption doesn&#x27;t cover them");
    expect(html).toContain("Tell the people present before you record a meeting.");
  });

  it("is part of the WhisperWoof settings page", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    try {
      const { default: WhisperWoofSettings } =
        await import("../../ui/settings/WhisperWoofSettings");
      expect(renderToStaticMarkup(createElement(WhisperWoofSettings))).toContain(
        "Transcribe Cardputer recordings"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
