/**
 * A clipboard image's preview, loaded by entry id when it scrolls into view
 * (the Clipboard view's tiles and "Look closer", and ⌘K search results).
 */

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { cn } from "../../../components/lib/utils";

interface PreviewApi {
  whisperwoofClipboardPreview?: (
    id: string,
    o?: { size: "thumb" | "large" }
  ) => Promise<{ success: boolean; data?: string; mime?: string } | undefined>;
}
const api = (): PreviewApi => (window as unknown as { electronAPI?: PreviewApi }).electronAPI ?? {};

export function Preview({ id, size = "thumb", className }: { readonly id: string; readonly size?: "thumb" | "large"; readonly className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api()
        .whisperwoofClipboardPreview?.(id, { size })
        .then((res) => {
          if (cancelled) return;
          if (res?.success && res.data) setSrc(`data:${res.mime ?? "image/png"};base64,${res.data}`);
          else setFailed(true);
        })
        .catch(() => !cancelled && setFailed(true));
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      void load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [id, size]);

  return (
    <div ref={ref} className={cn("flex items-center justify-center bg-surface-1", className)}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-contain" draggable={false} />
      ) : (
        <ImageIcon size={18} className={cn("text-muted-foreground/60", failed ? "" : "animate-pulse")} aria-hidden="true" />
      )}
    </div>
  );
}

