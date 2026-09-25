import { useTranslation } from 'react-i18next';
import { Clipboard, FileText, FolderOpen } from 'lucide-react';
import type { DictationRoute } from '../../core/router/dictation-route';

// Shown in the dictation overlay the moment Fn+T / Fn+N / Fn+P is pressed, so
// the user knows the letter registered and where the words will go. Plain
// paste-at-cursor shows nothing.

const ROUTE_ICON = {
  'copy-to-clipboard': Clipboard,
  'save-as-markdown': FileText,
  project: FolderOpen,
} as const;

interface RouteChipProps {
  route: DictationRoute;
  size?: 'sm' | 'md';
}

export function RouteChip({ route, size = 'md' }: RouteChipProps) {
  const { t } = useTranslation();
  if (route === 'paste-at-cursor') return null;

  const Icon = ROUTE_ICON[route];
  // A sign, not prose: English in every UI language (as the live panel's pill).
  const en = { lng: 'en' } as const;
  const label = {
    'copy-to-clipboard': t('app.live.routeCopy', { ...en, defaultValue: 'Copy' }),
    'save-as-markdown': t('app.live.routeNote', { ...en, defaultValue: 'Note' }),
    project: t('app.live.routeProject', { ...en, defaultValue: 'Project' }),
  }[route];
  const sizing = size === 'sm' ? 'px-1.5 text-[9px] leading-[14px]' : 'px-2 text-[11px] leading-[18px]';

  return (
    <span
      key={route}
      className={`route-chip inline-flex items-center gap-1 rounded-full bg-primary font-semibold text-primary-foreground ${sizing}`}
    >
      <style>{`
        @keyframes routeChipIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: none; } }
        .route-chip { animation: routeChipIn 160ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .route-chip { animation: none; } }
      `}</style>
      <Icon size={size === 'sm' ? 9 : 11} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
}
