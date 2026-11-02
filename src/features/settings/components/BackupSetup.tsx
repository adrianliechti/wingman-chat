import { ArrowLeft, ArrowRight, Check, KeyRound, LoaderCircle, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { supportsPasskeys } from "@/shared/lib/passkey";
import { PinForm } from "./PinForm";

interface BackupSetupProps {
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
  const [step, setStep] = useState<"intro" | "choose" | "finish">("intro");
  const passkeysAvailable = supportsPasskeys();
  const [method, setMethod] = useState<"passkey" | "pin">(() => (supportsPasskeys() ? "passkey" : "pin"));
  const methodId = useId();
  const progressRef = useRef<HTMLOListElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const previousStep = useRef(step);

  useEffect(() => {
    if (step !== "intro") progressRef.current?.focus();
    else if (previousStep.current !== "intro") startRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  function goBack() {
    onReset();
    setStep("choose");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Online backup</h4>
              <span
                role="status"
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              >
                Off
              </span>
            </div>
            {step === "intro" && (
              <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                Your data is saved only in this browser. Turn on backup to keep a copy online.
              </p>
            )}
          </div>
        </div>
        {step === "intro" && (
          <button
            ref={startRef}
            type="button"
            className={`${primaryButton} shrink-0`}
            onClick={() => setStep("choose")}
          >
            Start backup
          </button>
        )}
      </div>

      {step !== "intro" && (
        <div className="space-y-4">
          <ol
            ref={progressRef}
            tabIndex={-1}
            aria-label="Backup setup progress"
            className="grid grid-cols-2 gap-4 text-xs focus:outline-none"
          >
            {(["Choose protection", "Turn on backup"] as const).map((label, index) => {
              const current = (step === "choose" ? 0 : 1) === index;
              const completed = step === "finish" && index === 0;
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

          {step === "choose" ? (
            <>
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="mb-2.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                  Choose how you’ll unlock your backup on another device.
                </legend>
                {(["passkey", "pin"] as const).map((option) => {
                  const isPasskey = option === "passkey";
                  const disabled = isPasskey && !passkeysAvailable;
                  const OptionIcon = isPasskey ? KeyRound : Lock;
                  return (
                    <label
                      key={option}
                      className={`flex items-start gap-2.5 rounded-lg border p-3 transition-colors focus-within:border-neutral-500 dark:focus-within:border-neutral-400 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${method === option ? "border-neutral-400 bg-neutral-50 dark:border-neutral-500 dark:bg-neutral-800/50" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/30"}`}
                    >
                      <OptionIcon
                        size={14}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-neutral-500 dark:text-neutral-400"
                      />
                      <span className="min-w-0 flex-1 space-y-1.5">
                        <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-neutral-900 dark:text-neutral-100">
                          <span>{isPasskey ? "Passkey" : "PIN"}</span>
                          {isPasskey && (
                            <span className="rounded-full bg-neutral-200/70 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                              Recommended
                            </span>
                          )}
                        </span>
                        <span
                          id={`${methodId}-${option}-description`}
                          className="block text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
                        >
                          {isPasskey
                            ? disabled
                              ? "Not available in this browser. You can use a PIN."
                              : "Unlock with your device or password manager."
                            : "Use a code you’ll remember to restore your data."}
                        </span>
                      </span>
                      <input
                        type="radio"
                        name={methodId}
                        value={option}
                        checked={method === option}
                        disabled={disabled}
                        onChange={() => setMethod(option)}
                        aria-label={isPasskey ? "Passkey (recommended)" : "PIN"}
                        aria-describedby={`${methodId}-${option}-description`}
                        className="mt-0.5 size-3.5 shrink-0 accent-neutral-900 outline-none ring-0 dark:accent-neutral-100"
                      />
                    </label>
                  );
                })}
              </fieldset>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    onReset();
                    setStep("intro");
                  }}
                >
                  Cancel
                </button>
                <button type="button" className={primaryButton} onClick={() => setStep("finish")}>
                  Continue
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : method === "pin" ? (
            <PinForm
              title="Create your backup PIN"
              description="You’ll use this PIN to restore your data. Keep it somewhere safe. We can’t recover it for you."
              fields={[
                { label: "New PIN", value: pin, setter: onPinChange },
                { label: "Confirm PIN", value: confirmation, setter: onConfirmationChange },
              ]}
              error={error}
              busy={busy}
              onSubmit={onSetPin}
              onCancel={goBack}
              cancelLabel="Back"
              confirmLabel="Turn on backup"
            />
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Create your passkey</h4>
                <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                  Your device or password manager will guide you through creating and confirming your passkey. You may
                  see several prompts.
                </p>
              </div>
              {error && (
                <div className="space-y-2">
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                    Passkey setup didn’t finish. Try again, or go back to choose a PIN.
                  </p>
                  <details className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    <summary className="cursor-pointer">Error details</summary>
                    <p className="mt-1 break-words">{error}</p>
                  </details>
                </div>
              )}
              {busy && (
                <p role="status" className="text-xs text-neutral-500 dark:text-neutral-400">
                  Complete the prompts on your device. Backups will start when setup is finished.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy}
                  onClick={goBack}
                >
                  <ArrowLeft size={13} aria-hidden="true" />
                  Back
                </button>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy || !passkeysAvailable}
                  onClick={() => void onSetPasskey()}
                >
                  {busy ? (
                    <LoaderCircle size={13} aria-hidden="true" className="animate-spin" />
                  ) : (
                    <KeyRound size={13} aria-hidden="true" />
                  )}
                  {busy ? "Waiting for your device…" : "Create passkey & turn on backup"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
