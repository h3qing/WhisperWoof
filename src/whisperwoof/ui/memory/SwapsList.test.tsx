import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { SwapsList } from "./SwapsList";

type Node = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };

/** Every element in the tree, depth first. */
function walk(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!isValidElement(node)) return [];
  const el = node as unknown as Node;
  return [el, ...walk(el.props.children)];
}

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!isValidElement(node)) return "";
  return text((node as unknown as Node).props.children);
}

const buttons = (el: ReactElement) => walk(el).filter((n) => n.type === "button");

describe("SwapsList", () => {
  it("explains how swaps get here when there are none", () => {
    const el = SwapsList({ swaps: [], onRemove: vi.fn() });
    expect(text(el)).toContain("fix the same mishearing twice");
    expect(buttons(el)).toHaveLength(0);
  });

  it("lists each approved swap, misheard text first", () => {
    const el = SwapsList({
      swaps: [
        { from: "super base", to: "Supabase" },
        { from: "shunade", to: "Sinead" },
      ],
      onRemove: vi.fn(),
    });
    const t = text(el);
    expect(t).toContain("super base");
    expect(t).toContain("Supabase");
    expect(t.indexOf("super base")).toBeLessThan(t.indexOf("Supabase"));
    expect(t).toContain("shunade");
    expect(buttons(el)).toHaveLength(2);
  });

  it("stops a swap with the right pair, and says what the button does", () => {
    const onRemove = vi.fn();
    const el = SwapsList({ swaps: [{ from: "super base", to: "Supabase" }], onRemove });
    const [btn] = buttons(el);
    expect(btn!.props["aria-label"]).toBe("Stop changing “super base” to “Supabase”");
    (btn!.props.onClick as () => void)();
    expect(onRemove).toHaveBeenCalledWith({ from: "super base", to: "Supabase" });
  });
});
