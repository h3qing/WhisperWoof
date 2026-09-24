import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    // Every control is a capsule; a press answers with a small spring.
    "press rounded-full text-sm font-medium cursor-pointer select-none",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary CTA: the one caramel action in a view, with a soft glow under it
        default: [
          "relative text-primary-foreground font-semibold tracking-[0.005em]",
          "bg-primary/88",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_2px_8px_-2px_var(--color-primary)]",
          "hover:bg-primary/95",
        ].join(" "),

        // Success — uses design tokens
        success: [
          "relative text-success-foreground font-semibold tracking-[0.01em]",
          "bg-success",
          "border border-success/70",
          "shadow-sm",
          "hover:bg-success/90",
        ].join(" "),

        // Destructive — uses design tokens
        destructive: [
          "relative text-destructive-foreground font-semibold tracking-[0.01em]",
          "bg-destructive",
          "border border-destructive/70",
          "shadow-sm",
          "hover:bg-destructive/90",
        ].join(" "),

        // Outline: the neutral capsule. A strong tint with a lit top edge and a
        // hairline border, so it reads on a sheet and on glass alike (no blur of
        // its own: no glass on glass).
        outline: [
          "relative font-medium",
          "text-foreground bg-[var(--glass-strong)] border border-border",
          "shadow-[inset_0_1px_0_var(--glass-rim-hi),0_1px_2px_var(--glass-shade)]",
          "hover:bg-accent",
        ].join(" "),

        // Outline flat — transparent with thin border, no fill or shadow
        "outline-flat": [
          "font-medium",
          "text-muted-foreground bg-transparent",
          "border border-border/60",
          "hover:text-foreground hover:border-border-hover hover:bg-accent/40",
        ].join(" "),

        // Secondary — neutral solid, never amber
        secondary: [
          "relative font-medium",
          "text-secondary-foreground bg-secondary",
          "border border-border/50",
          "hover:bg-accent",
        ].join(" "),

        // Ghost — transparent until hovered
        ghost: [
          "font-medium",
          "text-foreground",
          "hover:bg-accent/70",
        ].join(" "),

        // Link — uses design tokens
        link: [
          "font-medium",
          "text-primary",
          "hover:text-primary/80 hover:underline",
          "underline-offset-4",
        ].join(" "),

        // Social button for auth flows — neutral glass
        social: [
          "relative font-medium",
          "text-foreground glass gap-2",
          "hover:bg-accent/60",
        ].join(" "),
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs gap-1.5",
        lg: "h-12 px-6 text-sm",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
