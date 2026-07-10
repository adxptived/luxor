/**
 * Onboarding state management.
 *
 * Tracks whether the user has completed the first-run welcome flow.
 * State is persisted in localStorage so it survives across sessions.
 * The onboarding flow introduces:
 * 1. Opening a project folder
 * 2. Terminal basics
 * 3. Panel layout (split/drag)
 * 4. Command palette
 * 5. Git explorer
 */

const STORAGE_KEY = "luxor.onboarding";
const COMPLETED_KEY = "luxor.onboarding.completed";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  /** Optional hotkey hint to display. */
  hotkey?: string;
  /** Whether this step has been completed. */
  done: boolean;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to Luxor",
    description: "Your desktop cockpit for AI-assisted coding. Let's get you set up in a few quick steps.",
    done: false,
  },
  {
    id: "open-folder",
    title: "Open a project folder",
    description: "Click 'Open folder' on the welcome screen, or press Ctrl+O to attach a project directory. This enables Files, Git, Search and Launcher panels.",
    hotkey: "Ctrl+O",
    done: false,
  },
  {
    id: "terminal",
    title: "Open a terminal",
    description: "Press Ctrl+` to open a new terminal. You can split terminals side-by-side and save the arrangement as a layout preset.",
    hotkey: "Ctrl+`",
    done: false,
  },
  {
    id: "panels",
    title: "Arrange panels",
    description: "Drag panel tabs to split the layout. Right-click tabs for more options. Use the + button to add new panels.",
    done: false,
  },
  {
    id: "command-palette",
    title: "Command palette",
    description: "Press Ctrl+Shift+P to open the command palette. Search and run any action without leaving the keyboard.",
    hotkey: "Ctrl+Shift+P",
    done: false,
  },
  {
    id: "git",
    title: "Git explorer",
    description: "Press Ctrl+Shift+G to open the Git explorer. View changes, stage files, commit, and browse history — all powered by libgit2.",
    hotkey: "Ctrl+Shift+G",
    done: false,
  },
];

export interface OnboardingState {
  /** Whether onboarding has been completed (all steps done or dismissed). */
  completed: boolean;
  /** Index of the current step (0-based). */
  currentStep: number;
  /** Which steps have been completed. */
  doneSteps: Set<string>;
  /** Whether the onboarding tour is currently active. */
  active: boolean;
}

let state: OnboardingState = loadState();

// Subscribers are notified whenever the tour is started/advanced/dismissed, so
// a component mounted before `startOnboarding()` runs (e.g. OnboardingTour, which
// mounts at app boot while the trigger fires after the splash) still reacts.
const listeners = new Set<() => void>();

/** Subscribe to onboarding state changes. Returns an unsubscribe fn. */
export function subscribeOnboarding(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

function loadState(): OnboardingState {
  if (typeof localStorage === "undefined") {
    return { completed: false, currentStep: 0, doneSteps: new Set(), active: false };
  }
  try {
    const completed = localStorage.getItem(COMPLETED_KEY) === "true";
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { currentStep: number; doneSteps: string[]; active: boolean };
      return {
        completed,
        currentStep: parsed.currentStep ?? 0,
        doneSteps: new Set(parsed.doneSteps ?? []),
        active: parsed.active ?? false,
      };
    }
  } catch {
    // Corrupted state — start fresh.
  }
  return { completed: false, currentStep: 0, doneSteps: new Set(), active: false };
}

function saveState(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentStep: state.currentStep,
      doneSteps: Array.from(state.doneSteps),
      active: state.active,
    }));
    localStorage.setItem(COMPLETED_KEY, String(state.completed));
  } catch {
    // Storage full or unavailable — non-critical.
  }
}

/** Check if the user needs onboarding (first run). */
export function needsOnboarding(): boolean {
  return !state.completed;
}

/** Start the onboarding tour. */
export function startOnboarding(): void {
  state = { ...state, active: true, currentStep: 0 };
  saveState();
  notify();
}

/** Get the current onboarding state. */
export function getOnboardingState(): OnboardingState {
  return { ...state, doneSteps: new Set(state.doneSteps) };
}

/** Mark a step as completed and advance to the next. */
export function completeStep(stepId: string): void {
  state.doneSteps.add(stepId);
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === stepId);
  if (stepIndex >= 0 && stepIndex === state.currentStep) {
    state.currentStep = stepIndex + 1;
  }
  // Check if all steps are done.
  if (state.currentStep >= ONBOARDING_STEPS.length) {
    state.completed = true;
    state.active = false;
  }
  saveState();
  notify();
}

/** Skip the onboarding tour entirely. */
export function skipOnboarding(): void {
  state.completed = true;
  state.active = false;
  saveState();
  notify();
}

/** Reset onboarding (for testing or re-running the tour). */
export function resetOnboarding(): void {
  state = { completed: false, currentStep: 0, doneSteps: new Set(), active: false };
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(COMPLETED_KEY);
  }
  notify();
}

/** Get the current step, or null if onboarding is complete/inactive. */
export function currentOnboardingStep(): OnboardingStep | null {
  if (!state.active || state.currentStep >= ONBOARDING_STEPS.length) return null;
  return ONBOARDING_STEPS[state.currentStep];
}
