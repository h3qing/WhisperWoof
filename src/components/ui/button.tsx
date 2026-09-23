import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md text-sm font-medium cursor-pointer select-none",
    "transition-[background-color,border-color,color,transform] duration-200 ease-out",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary CTA — the one amber (glass-tint) action in a view
        default: [
          "relative text-primary-foreground font-semibold tracking-[0.005em]",
          "bg-primary",
          "border border-primary/60",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]",
          "hover:bg-primary/92",
          "active:bg-primary/85 active:scale-[0.985]",
        ].join(" "),

        // Success — uses design tokens
        success: [
          "relative text-success-foreground font-semibold tracking-[0.01em]",
          "bg-success",
          "border border-success/70",
          "shadow-sm",
          "hover:bg-success/90",
          "active:bg-success/80 active:scale-[0.98]",
        ].join(" "),

        // Destructive — uses design tokens
        destructive: [
          "relative text-destructive-foreground font-semibold tracking-[0.01em]",
          "bg-destructive",
          "border border-destructive/70",
          "shadow-sm",
          "hover:bg-destructive/90",
          "active:bg-destructive/80 active:scale-[0.98]",
        ].join(" "),

        // Outline — neutral control. Lives on content cards, so solid and light
        // (glass is for the functional layer, and a shadow per button is noise).
        outline: [
          "relative font-medium",
          "text-foreground bg-surface-2/80 border border-border",
          "hover:bg-accent/60 hover:border-border-hover",
          "active:scale-[0.985]",
        ].join(" "),

        // Outline flat — transparent with thin border, no fill or shadow
        "outline-flat": [
          "font-medium",
          "text-muted-foreground bg-transparent",
          "border border-border/60",
          "hover:text-foreground hover:border-border-hover hover:bg-accent/40",
          "active:scale-[0.98]",
        ].join(" "),

        // Secondary — neutral solid, never amber
        secondary: [
          "relative font-medium",
          "text-secondary-foreground bg-secondary",
          "border border-border/50",
          "hover:bg-accent",
          "active:scale-[0.98]",
        ].join(" "),

        // Ghost — transparent until hovered
        ghost: [
          "font-medium",
          "text-foreground",
          "hover:bg-accent/70",
          "active:scale-[0.98]",
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
          "active:scale-[0.985]",
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
