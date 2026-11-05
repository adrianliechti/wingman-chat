import { Check, KeyRound, LoaderCircle } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { supportsPasskeys } from "@/shared/lib/passkey";
import { PinForm } from "./PinForm";

export type BackupSetupStep = "intro" | "pin" | "passkey";

interface BackupSetupProps {
  step: BackupSetupStep;
  onStepChange: (step: BackupSetupStep) => void;
  startRef: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  error: string | null;
  pin: string;
  confirmation: string;
  onPinChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  onSetPin: () => Promise<void>;
  onSetPasskey: () => Promise<void>;
  onReset: () => void;
}

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300";
const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200";

export function BackupSetup({
  step,
  onStepChange: setStep,
  startRef,
  busy,
  error,
  pin,
  confirmation,
  onPinChange,
  onConfirmationChange,
  onSetPin,
  onSetPasskey,
  onReset,
}: BackupSetupProps) {
  const passkeysAvailable = supportsPasskeys();
  const progressRef = useRef<HTMLOListElement>(null);
  const previousStep = useRef(step);

  useEffect(() => {
    if (step !== "intro") progressRef.current?.focus();
    else if (previousStep.current !== "intro") startRef.current?.focus();
    previousStep.current = step;
  }, [step, startRef]);

  function finish() {
    onReset();
    setStep("intro");
  }

  if (step === "intro") return null;

  return (
    <div className="space-y-4">
      <ol
        ref={progressRef}
        tabIndex={-1}
        aria-label="Backup setup progress"
        className="grid grid-cols-2 gap-4 text-xs focus:outline-none"
      >
        {(["Create PIN", "Add passkey (optional)"] as const).map((label, index) => {
          const current = (step === "pin" ? 0 : 1) === index;
          const completed = step === "passkey" && index === 0;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-2 border-b pb-2.5 ${current || completed ? "border-neutral-500 text-neutral-800 dark:border-neutral-400 dark:text-neutral-200" : "border-neutral-200 text-neutral-400 dark:border-neutral-800 dark:text-neutral-500"}`}
            >
              <span
                aria-label={`Step ${index + 1}${completed ? ", complete" : ""}`}
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${current ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 dark:bg-neutral-800"}`}
              >
                {completed ? <Check size={12} aria-hidden="true" /> : index + 1}
              </span>
              <span className={current ? "font-medium" : undefined}>{label}</span>
            </li>
          );
        })}
      </ol>

      {step === "pin" ? (
        <PinForm
          title="Create your backup PIN"
          description="Your data is encrypted. You’ll use this PIN to restore it."
          warning="Without your PIN or a passkey, you won’t be able to restore your backup. Don’t forget your PIN. We can’t recover it for you."
          fields={[
            { label: "New PIN", value: pin, setter: onPinChange },
            { label: "Confirm PIN", value: confirmation, setter: onConfirmationChange },
          ]}
          error={error}
          busy={busy}
          onSubmit={onSetPin}
          onCancel={finish}
          confirmLabel="Create PIN"
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <h4 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Create your passkey</h4>
            <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              Your PIN is saved and backup is on. Add a passkey to also unlock with your device or password manager, or
              skip this step and add one later.
            </p>
          </div>
          {!passkeysAvailable && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Passkeys aren’t available in this browser. You can skip this step and use your PIN.
            </p>
          )}
          {error && (
            <div className="space-y-2">
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                Passkey setup didn’t finish. Try again or skip this step. Your PIN will keep working.
              </p>
              <details className="text-[11px] text-neutral-500 dark:text-neutral-400">
                <summary className="cursor-pointer">Error details</summary>
                <p className="mt-1 break-words">{error}</p>
              </details>
            </div>
          )}
          {busy && (
            <p role="status" className="text-xs text-neutral-500 dark:text-neutral-400">
              Complete the prompts on your device.
            </p>
          )}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <button type="button" className={secondaryButton} disabled={busy} onClick={finish}>
              Skip for now
            </button>
            <button
              type="button"
              className={`${primaryButton} justify-self-end`}
              disabled={busy || !passkeysAvailable}
              onClick={() => void onSetPasskey()}
            >
              {busy ? (
                <LoaderCircle size={13} aria-hidden="true" className="animate-spin" />
              ) : (
                <KeyRound size={13} aria-hidden="true" />
              )}
              {busy ? "Waiting for your device…" : "Create passkey"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
