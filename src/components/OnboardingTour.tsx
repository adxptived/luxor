/**
 * Onboarding tour overlay component.
 *
 * Shows a step-by-step guide for first-time users. Each step highlights
 * a key feature with a description and optional hotkey hint. The tour
 * can be skipped at any time and progress is persisted.
 *
 * Phase 10 — Onboarding and empty states.
 */

import { ChevronRight, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import {
  ONBOARDING_STEPS,
  completeStep,
  currentOnboardingStep,
  getOnboardingState,
  skipOnboarding,
  startOnboarding,
  subscribeOnboarding,
} from "@/lib/onboarding";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { announce } from "@/lib/useAriaLive";

/** Localized title for a step: `onboarding.<id>` keyed entry, English fallback. */
function stepTitle(step: (typeof ONBOARDING_STEPS)[number]): string {
  return t(`onboarding.${step.id}`, step.title);
}
/** Localized description: `onboarding.<id>.desc` keyed entry, English fallback. */
function stepDesc(step: (typeof ONBOARDING_STEPS)[number]): string {
  return t(`onboarding.${step.id}.desc`, step.description);
}

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // On "Try it now" (hotkey) steps the user must be able to Tab/type into the
  // app underneath, so the trap is disabled there; on all other steps it keeps
  // focus inside the card.
  const trapActive = active && !ONBOARDING_STEPS[stepIdx]?.hotkey;
  useFocusTrap(containerRef, trapActive);

  // Subscribe so the tour reacts to `startOnboarding()` firing AFTER mount
  // (App triggers it once the splash is dismissed, long after this mounts).
  useEffect(() => {
    const sync = () => {
      const state = getOnboardingState();
      setActive(state.active);
      setStepIdx(state.currentStep);
    };
    sync();
    return subscribeOnboarding(sync);
  }, []);

  if (!active) return null;

  const step = ONBOARDING_STEPS[stepIdx];
  if (!step) return null;

  const next = () => {
    completeStep(step.id);
    const nextStep = currentOnboardingStep();
    if (nextStep) {
      const idx = ONBOARDING_STEPS.findIndex((s) => s.id === nextStep.id);
      setStepIdx(idx >= 0 ? idx : 0);
      announce(stepTitle(nextStep));
    } else {
      setActive(false);
      announce(t("onboarding.finish", "Setup complete"));
    }
  };

  const skip = () => {
    skipOnboarding();
    setActive(false);
  };

  const isLast = stepIdx >= ONBOARDING_STEPS.length - 1;

  // On steps that invite the user to press a hotkey ("Try it now"), the invoked
  // surface (command palette / switcher, at --lx-z-overlay) would otherwise open
  // *behind* this overlay's dark scrim. So for hotkey steps we drop the scrim,
  // let clicks/keys pass through to the app underneath, and dock the card at the
  // bottom — keeping the centered palette result fully visible and usable.
  const passthrough = Boolean(step.hotkey);

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[var(--lx-z-onboarding)] flex justify-center ${
        passthrough
          ? "pointer-events-none items-end pb-10"
          : "items-center bg-black/60 backdrop-blur-sm"
      }`}
      role="dialog"
      aria-modal={passthrough ? undefined : true}
      aria-label={t("onboarding.welcome", "Welcome to Luxor")}
    >
      <div className="lx-anim-modal pointer-events-auto w-[28rem] max-w-[92vw] rounded-lg border border-edge bg-bar p-6 shadow-2xl shadow-black/40">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("onboarding.step", "Step")} {stepIdx + 1} {t("onboarding.of", "of")} {ONBOARDING_STEPS.length}
          </span>
          <button
            onClick={skip}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-raised hover:text-strong"
            aria-label={t("onboarding.skip", "Skip")}
          >
            <SkipForward size={12} /> {t("onboarding.skip", "Skip")}
          </button>
        </div>

        <h2 className="mt-3 text-lg font-semibold text-strong">{stepTitle(step)}</h2>
        <p className="mt-2 text-sm leading-5 text-muted">{stepDesc(step)}</p>

        {step.hotkey && (
          <div className="mt-4 flex items-center gap-2">
            <kbd className="rounded-lg border border-edge bg-raised px-3 py-1.5 font-mono text-sm text-accent">
              {step.hotkey}
            </kbd>
            <span className="text-xs text-muted">{t("Try it now", "Try it now")}</span>
          </div>
        )}

        {/* Progress dots */}
        <div className="mt-5 flex items-center gap-1.5">
          {ONBOARDING_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-[width,background-color] ${
                i === stepIdx ? "w-6 bg-accent" : i < stepIdx ? "w-1.5 bg-accent/50" : "w-1.5 bg-edge"
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={skip}
            className="rounded-lg border border-edge px-3 py-2 text-sm text-muted hover:bg-raised hover:text-strong"
          >
            {t("onboarding.skip", "Skip")}
          </button>
          <button
            onClick={next}
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20"
          >
            {isLast ? t("onboarding.finish", "Finish") : t("onboarding.next", "Next")}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-export for external control.
export { startOnboarding };
