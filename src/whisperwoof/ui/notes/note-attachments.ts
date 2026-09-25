/**
 * Images a note links to (clipboard images saved as notes land in the notes
 * folder's `attachments/`). Mirrors noteImageRefs in bridge/clipboard-pure.js,
 * which the main process uses to decide what it will read; a test keeps the
 * two in step.
 */

const IMAGE_LINK = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i;

function isSafeAttachmentRef(ref: string): boolean {
  if (!ref.startsWith("attachments/")) return false;
  const name = ref.slice("attachments/".length);
  return name.length > 0 && !/[/\\]/.test(name) && !name.startsWith(".") && IMAGE_EXT.test(name);
}

export function noteImageRefs(body: string): string[] {
  const refs: string[] = [];
  for (const match of String(body ?? "").matchAll(IMAGE_LINK)) {
    let ref: string;
    try {
      ref = decodeURIComponent(match[1]);
    } catch {
      continue;
    }
    if (isSafeAttachmentRef(ref) && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/** A body line without Markdown image syntax, for one-line previews. */
export function withoutImageLinks(text: string): string {
  return String(text ?? "").replace(IMAGE_LINK, "Image");
}
