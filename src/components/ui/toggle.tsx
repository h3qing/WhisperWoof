import React from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const Toggle = ({ checked, onChange, disabled = false }: ToggleProps) => {
  const getTrackClasses = () => {
    if (disabled) {
      return checked ? "bg-primary/40" : "bg-muted";
    }
    return checked
      ? "bg-primary/88 hover:bg-primary"
      : "bg-muted-foreground/30 hover:bg-muted-foreground/40";
  };

  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 ${getTrackClasses()} ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full transition-transform duration-[320ms] ease-[cubic-bezier(.3,.7,.3,1.15)] ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        } ${disabled ? "bg-muted-foreground/50" : "bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)]"}`}
      />
    </button>
  );
};
