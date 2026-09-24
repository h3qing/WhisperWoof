import React from "react";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  children,
  className = "",
}) => {
  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <h3 className="text-[15px] font-bold text-foreground tracking-[-0.01em]">{title}</h3>
        {description && (
          <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
};

interface SettingsGroupProps {
  title?: string;
  children: React.ReactNode;
  variant?: "default" | "highlighted";
  className?: string;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  children,
  variant = "default",
  className = "",
}) => {
  // A nested panel on the settings sheet: sheet radius minus its inset, no shadow.
  const baseClasses = "space-y-3 p-3.5 rounded-[14px] border";
  const variantClasses = {
    default: "bg-surface-1 border-transparent",
    highlighted: "bg-primary/8 border-primary/25",
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {title && <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>}
      {children}
    </div>
  );
};

interface SettingsRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  description,
  children,
  className = "",
}) => {
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {description && (
          <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
};

export function SettingsPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[14px] bg-surface-1 divide-y divide-border ${className}`}
    >
      {children}
    </div>
  );
}

export function SettingsPanelRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[15px] font-bold text-foreground tracking-[-0.01em]">{title}</h3>
      {description && (
        <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      )}
    </div>
  );
}
