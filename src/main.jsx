import React, { Suspense, useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import App from "./App.jsx";
import AuthenticationStep from "./components/AuthenticationStep.tsx";
import WindowControls from "./components/WindowControls.tsx";
import { Card, CardContent } from "./components/ui/card.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { ToastProvider } from "./components/ui/Toast.tsx";
import { SettingsProvider } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { useAuth } from "./hooks/useAuth";
import { areRequiredPermissionsMet } from "./utils/permissions";
import i18n from "./i18n";
import "./index.css";

const controlPanelImport = () => import("./components/ControlPanel.tsx");
const onboardingFlowImport = () => import("./components/OnboardingFlow.tsx");
const agentOverlayImport = () => import("./components/AgentOverlay.tsx");
const permissionsGateImport = () => import("./components/PermissionsGate.tsx");
const ControlPanel = React.lazy(controlPanelImport);
const OnboardingFlow = React.lazy(onboardingFlowImport);
const AgentOverlay = React.lazy(agentOverlayImport);
const PermissionsGate = React.lazy(permissionsGateImport);
import MeetingNotificationOverlay from "./components/MeetingNotificationOverlay.tsx";
import UpdateNotificationOverlay from "./components/UpdateNotificationOverlay.tsx";

let root = null;

const VALID_CHANNELS = new Set(["development", "staging", "production"]);
const DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL = {
  development: "openwhispr-dev",
  staging: "openwhispr-staging",
  production: "openwhispr",
};
const inferredChannel = import.meta.env.DEV ? "development" : "production";
const configuredChannel = (import.meta.env.VITE_OPENWHISPR_CHANNEL || inferredChannel)
  .trim()
  .toLowerCase();
const APP_CHANNEL = VALID_CHANNELS.has(configuredChannel) ? configuredChannel : inferredChannel;
const defaultOAuthProtocol =
  DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL[APP_CHANNEL] || DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL.production;
const OAUTH_PROTOCOL = (import.meta.env.VITE_OPENWHISPR_PROTOCOL || defaultOAuthProtocol)
  .trim()
  .toLowerCase();
const OAUTH_AUTH_BRIDGE_URL = (import.meta.env.VITE_OPENWHISPR_AUTH_BRIDGE_URL || "").trim();

// OAuth callback handler: when the browser redirects back from Google/Neon Auth
// with a session verifier, redirect to the configured custom protocol so Electron
// can capture it and complete authentication. This check runs before React
// mounts — if we detect we're in the system browser with a verifier, we
// redirect immediately and skip mounting the app entirely.
function isOAuthBrowserRedirect() {
  const params = new URLSearchParams(window.location.search);
  const verifier = params.get("neon_auth_session_verifier");
  const isInElectron = typeof window.electronAPI !== "undefined";

  if (verifier && !isInElectron) {
    const redirectTitle = i18n.t("app.oauth.redirectTitle");
    const closeTab = i18n.t("app.oauth.closeTab");

    if (OAUTH_AUTH_BRIDGE_URL) {
      try {
        const bridgeUrl = new URL(OAUTH_AUTH_BRIDGE_URL);
        bridgeUrl.searchParams.set("neon_auth_session_verifier", verifier);
        window.location.replace(bridgeUrl.toString());
        return true;
      } catch {
        // Fall back to protocol redirect below.
      }
    }

    setTimeout(() => {
      window.location.href = `${OAUTH_PROTOCOL}://auth/callback?neon_auth_session_verifier=${encodeURIComponent(verifier)}`;
    }, 2000);

    document.body.innerHTML = `
      <style>
        /* Design tokens from index.css — single source of truth */
        :root {
          --bg: #f6f0e8;
          --surface-1: #fbf6ef;
          --surface-2: #fffbf6;
          --border: #e4d8c9;
          --border-subtle: #e9dfd2;
          --text-primary: #2a2019;
          --text-muted: #6e6055;
          --primary: #9c602b;
          --primary-foreground: #fff8f0;
          --logo-glow: rgb(156 96 43 / 0.2);
          --shadow-card: 0 1px 2px rgb(80 45 15 / 0.06), 0 0 0 0.5px rgb(90 60 30 / 0.1);
          --shadow-elevated: 0 10px 30px -8px rgb(80 45 15 / 0.22);
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --bg: oklch(0.18 0.01 67);
            --surface-1: oklch(0.21 0.012 67);
            --surface-2: oklch(0.24 0.013 67);
            --border: oklch(0.31 0.016 60);
            --border-subtle: oklch(0.28 0.012 60);
            --text-primary: oklch(0.93 0.012 75);
            --text-muted: oklch(0.66 0.02 65);
            --primary: oklch(0.7 0.11 62);
            --primary-foreground: oklch(0.17 0.02 60);
            --logo-glow: rgb(232 160 96 / 0.25);
            --shadow-card: 0 1px 3px oklch(0 0 0 / 0.25);
            --shadow-elevated: 0 8px 24px oklch(0 0 0 / 0.4);
          }
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          background: var(--bg);
          color: var(--text-primary);
          font-family: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          transition: background 150ms ease, color 150ms ease;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        #oauth-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }

        /* Premium glass card — native macOS feel */
        .auth-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 32px 40px;
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: var(--shadow-elevated);
          animation: fade-in 300ms ease-out;
        }

        @media (prefers-color-scheme: dark) {
          .auth-card {
            background: var(--surface-2);
            border: 1px solid var(--border);
            box-shadow: var(--shadow-elevated), 0 0 0 1px rgb(255 228 196 / 0.06);
          }
        }

        /* Logo container with refined drop shadow */
        .logo-wrapper {
          position: relative;
          margin-bottom: 4px;
        }

        .logo {
          display: block;
          filter: drop-shadow(0 2px 10px var(--logo-glow));
        }

        /* Premium spinner with metallic feel */
        .spinner-wrapper {
          position: relative;
          width: 28px;
          height: 28px;
        }

        .spinner {
          width: 28px;
          height: 28px;
          border: 2.5px solid transparent;
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spinner-rotate 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        /* Tight, minimal text hierarchy */
        .content {
          text-align: center;
          line-height: 1.4;
        }

        h1 {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--text-primary);
          margin-bottom: 2px;
        }

        .subtitle {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-muted);
          opacity: 0.8;
        }

        /* Smooth animations */
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(4px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes spinner-rotate {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        /* Accessibility — respect reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .auth-card {
            animation: fade-in-simple 200ms ease-out;
          }
          @keyframes fade-in-simple {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .spinner {
            animation: none;
            border-top-color: var(--text-muted);
            opacity: 0.5;
          }
        }
      </style>

      <div id="oauth-container" role="status" aria-live="polite">
        <div class="auth-card">
          <div class="logo-wrapper">
            <svg class="logo" viewBox="0 0 1024 1024" width="64" height="64" aria-label="OpenWhispr">
              <rect width="1024" height="1024" rx="241" fill="var(--primary)"/>
              <circle cx="512" cy="512" r="314" fill="var(--primary)" stroke="var(--primary-foreground)" stroke-width="74"/>
              <path d="M512 383V641" stroke="var(--primary-foreground)" stroke-width="74" stroke-linecap="round"/>
              <path d="M627 457V568" stroke="var(--primary-foreground)" stroke-width="74" stroke-linecap="round"/>
              <path d="M397 457V568" stroke="var(--primary-foreground)" stroke-width="74" stroke-linecap="round"/>
            </svg>
          </div>

          <div class="spinner-wrapper">
            <div class="spinner"></div>
          </div>

          <div class="content">
            <h1>${redirectTitle}</h1>
            <p class="subtitle">${closeTab}</p>
          </div>
        </div>
      </div>
    `;
    return true;
  }
  return false;
}

if (!isOAuthBrowserRedirect()) {
  mountApp();
}

function AppRouter() {
  useTheme();
  const params = window.location.search;

  if (params.includes("meeting-notification=true")) {
    return <MeetingNotificationOverlay />;
  }

  if (params.includes("update-notification=true")) {
    return <UpdateNotificationOverlay />;
  }

  return <MainApp />;
}

function MainApp() {
  const { isSignedIn, isGracePeriodOnly, isLoaded: authLoaded } = useAuth();

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [needsPermissions, setNeedsPermissions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isAgentPanel = window.location.search.includes("agent=true");
  const isControlPanel =
    !isAgentPanel &&
    (window.location.pathname.includes("control") || window.location.search.includes("panel=true"));
  const isDictationPanel = !isControlPanel && !isAgentPanel;

  // Preload lazy chunks while waiting for auth so Suspense resolves instantly
  useEffect(() => {
    if (isAgentPanel) {
      agentOverlayImport().catch(() => {});
    } else if (isControlPanel) {
      controlPanelImport().catch(() => {});
      permissionsGateImport().catch(() => {});
      if (!localStorage.getItem("onboardingCompleted")) {
        onboardingFlowImport().catch(() => {});
      }
    }
  }, [isControlPanel, isAgentPanel]);

  useEffect(() => {
    if (!authLoaded) return;

    const onboardingCompleted = localStorage.getItem("onboardingCompleted") === "true";
    const authSkipped =
      localStorage.getItem("authenticationSkipped") === "true" ||
      localStorage.getItem("skipAuth") === "true";

    // Actual session (not OAuth grace period) proves prior onboarding — restore flag if localStorage was wiped.
    // Guard with onboardingInProgress so first-time users mid-onboarding don't get auto-completed.
    const onboardingInProgress = localStorage.getItem("onboardingCurrentStep") !== null;
    const isReturningUser =
      !onboardingCompleted && isSignedIn && !isGracePeriodOnly && !onboardingInProgress;
    if (isReturningUser) {
      localStorage.setItem("onboardingCompleted", "true");
    }

    const resolved = localStorage.getItem("onboardingCompleted") === "true";

    if (isControlPanel) {
      if (!resolved) {
        setShowOnboarding(true);
      } else if (!isSignedIn && !authSkipped) {
        setNeedsReauth(true);
      } else {
        // Check permissions from localStorage — PermissionsGate does the real async checks
        const micOk = localStorage.getItem("micPermissionGranted") === "true";
        if (!areRequiredPermissionsMet(micOk)) {
          setNeedsPermissions(true);
        }
      }
    }

    if (isDictationPanel && !resolved) {
      const rawStep = parseInt(localStorage.getItem("onboardingCurrentStep") || "0");
      const currentStep = Math.max(0, Math.min(rawStep, 5));
      if (currentStep < 4) {
        window.electronAPI?.hideWindow?.();
      }
    }

    setIsLoading(false);
  }, [isControlPanel, isDictationPanel, isSignedIn, isGracePeriodOnly, authLoaded]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setNeedsPermissions(false); // onboarding already handled permissions
    localStorage.setItem("onboardingCompleted", "true");
  };

  const handlePermissionsComplete = () => {
    setNeedsPermissions(false);
  };

  if (isAgentPanel) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <AgentOverlay />
      </Suspense>
    );
  }

  if (isLoading) {
    return <LoadingFallback />;
  }

  // First-time user: full onboarding wizard
  if (isControlPanel && showOnboarding) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  // Returning user needs to re-authenticate (signed out, setup already done)
  if (isControlPanel && needsReauth) {
    return (
      <div
        className="h-screen flex flex-col bg-background"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div
          className="flex items-center justify-end w-full h-10 shrink-0"
          style={{ WebkitAppRegion: "drag" }}
        >
          {window.electronAPI?.getPlatform?.() !== "darwin" && (
            <div className="pr-1" style={{ WebkitAppRegion: "no-drag" }}>
              <WindowControls />
            </div>
          )}
        </div>
        <div className="flex-1 px-6 overflow-y-auto flex items-center">
          <div className="w-full max-w-sm mx-auto">
            <Card className="bg-card/90 backdrop-blur-2xl border border-border/50 dark:border-white/5 shadow-lg rounded-xl overflow-hidden">
              <CardContent className="p-6">
                <AuthenticationStep
                  onContinueWithoutAccount={() => {
                    localStorage.setItem("authenticationSkipped", "true");
                    localStorage.setItem("skipAuth", "true");
                    setNeedsReauth(false);
                  }}
                  onAuthComplete={() => setNeedsReauth(false)}
                  onNeedsVerification={() => {}}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Returning user missing permissions (new machine, re-auth, etc.)
  if (isControlPanel && needsPermissions) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <PermissionsGate onComplete={handlePermissionsComplete} />
      </Suspense>
    );
  }

  return isControlPanel ? (
    <Suspense fallback={<LoadingFallback />}>
      <ControlPanel />
    </Suspense>
  ) : (
    <App />
  );
}

function LoadingFallback({ message }) {
  const { t } = useTranslation();
  const fallbackMessage = message || t("common.loading");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 animate-[scale-in_300ms_ease-out]">
        <svg
          viewBox="0 0 1024 1024"
          className="w-12 h-12 drop-shadow-sm"
          aria-label="OpenWhispr"
        >
          <rect width="1024" height="1024" rx="241" fill="var(--color-primary)" />
          <circle cx="512" cy="512" r="314" fill="var(--color-primary)" stroke="var(--color-primary-foreground)" strokeWidth="74" />
          <path d="M512 383V641" stroke="var(--color-primary-foreground)" strokeWidth="74" strokeLinecap="round" />
          <path d="M627 457V568" stroke="var(--color-primary-foreground)" strokeWidth="74" strokeLinecap="round" />
          <path d="M397 457V568" stroke="var(--color-primary-foreground)" strokeWidth="74" strokeLinecap="round" />
        </svg>
        <div className="w-7 h-7 rounded-full border-[2.5px] border-transparent border-t-primary animate-[spinner-rotate_0.8s_cubic-bezier(0.4,0,0.2,1)_infinite] motion-reduce:animate-none motion-reduce:border-t-muted-foreground motion-reduce:opacity-50" />
        {fallbackMessage && (
          <p className="text-[13px] font-medium text-muted-foreground tracking-[-0.01em]">
            {fallbackMessage}
          </p>
        )}
      </div>
    </div>
  );
}

function mountApp() {
  if (!root) {
    root = ReactDOM.createRoot(document.getElementById("root"));
  }
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <I18nextProvider i18n={i18n}>
          <SettingsProvider>
            <ToastProvider>
              <AppRouter />
            </ToastProvider>
          </SettingsProvider>
        </I18nextProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
