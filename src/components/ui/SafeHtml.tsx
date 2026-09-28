import React from "react";

// Renders HTML from outside the app (release notes from the update feed) as
// React elements: a short list of formatting tags, text escaped by React,
// links only to http(s). Anything else (scripts, styles, frames, forms,
// images, attributes, event handlers) is dropped. Never innerHTML.

const ALLOWED_TAGS = new Set([
  "p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "code", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "a", "hr", "del", "s",
]);
const DROPPED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"]);

function safeHref(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function toReact(node: Node, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return null;
  const children = Array.from(el.childNodes).map((child, i) => toReact(child, `${key}.${i}`));
  if (!ALLOWED_TAGS.has(tag)) return <React.Fragment key={key}>{children}</React.Fragment>;
  if (tag === "br" || tag === "hr") return React.createElement(tag, { key });
  if (tag === "a") {
    return (
      <a key={key} href={safeHref(el.getAttribute("href"))} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  return React.createElement(tag, { key }, children);
}

export default function SafeHtml({ html, className }: { html: string; className?: string }) {
  const nodes = React.useMemo(() => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.body.childNodes).map((node, i) => toReact(node, String(i)));
  }, [html]);
  return <div className={className}>{nodes}</div>;
}
