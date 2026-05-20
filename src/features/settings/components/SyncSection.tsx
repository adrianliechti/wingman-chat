import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import * as chatSession from "@/shared/lib/chatSession";

type Status = "disabled" | "initializing" | "locked" | "ready" | "error";

const PIN_MIN_LEN = 4;
const PIN_MAX_LEN = 32;

function statusLabel(s: Status): string {
  switch (s) {
    case "disabled":
      return "Server sync disabled";
    case "initializing":
      return "Connecting…";
    case "locked":
      return "Locked — enter PIN to decrypt";
    case "ready":
      return "Synced and ready";
    case "error":
      return "Failed to initialize";
  }
}

export function SyncSection() {
  const [status, setStatus] = useState<Status>("initializing");
  const [pinProtected, setPinProtected] = useState(false);

  // PIN form state
  const [mode, setMode] = useState<"none" | "unlock" | "set" | "change" | "remove">("none");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void chatSession.initSession();
    return chatSession.subscribeSession((s) => {
      setStatus(s.status);
      if (s.status === "ready" || s.status === "locked") {
        setPinProtected(s.keystore.keystore.pinProtected === true);
      }
    });
  }, []);

  function resetForm() {
    setMode("none");
    setOldPin("");
    setNewPin("");
    setConfirmPin("");
    setError(null);
    setBusy(false);
  }

  function validatePin(pin: string): string | null {
    if (pin.length < PIN_MIN_LEN) return `PIN must be at least ${PIN_MIN_LEN} characters`;
    if (pin.length > PIN_MAX_LEN) return `PIN must be at most ${PIN_MAX_LEN} characters`;
    return null;
  }

  async function onUnlock() {
    setError(null);
    setBusy(true);
    try {
      await chatSession.unlock(oldPin);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSetPin() {
    setError(null);
    const v = validatePin(newPin);
    if (v) return setError(v);
    if (newPin !== confirmPin) return setError("PINs do not match");
    setBusy(true);
    try {
      await chatSession.setPin(newPin);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set PIN");
    } finally {
      setBusy(false);
    }
  }

  async function onChangePin() {
    setError(null);
    const v = validatePin(newPin);
    if (v) return setError(v);
    if (newPin !== confirmPin) return setError("New PINs do not match");
    setBusy(true);
    try {
      await chatSession.changePin(oldPin, newPin);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change PIN");
    } finally {
      setBusy(false);
    }
  }

  async function onRemovePin() {
    setError(null);
    setBusy(true);
    try {
      await chatSession.removePin(oldPin);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove PIN");
    } finally {
      setBusy(false);
    }
  }

  if (status === "disabled") {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Server-side sync is not enabled on this deployment. Chats are stored only in this browser.
      </p>
    );
  }

  const Icon = status === "ready" ? ShieldCheck : status === "locked" ? Lock : LockOpen;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Icon size={16} className="text-neutral-500 dark:text-neutral-400" />
        <span className="text-neutral-700 dark:text-neutral-300">{statusLabel(status)}</span>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        All chats are encrypted on your device before being sent to the server. Setting a PIN replaces the plaintext key
        on the server with a PIN-wrapped one — without your PIN, no one (including the server) can read your chats.{" "}
        <strong>Forgetting your PIN means losing access to your chats.</strong>
      </p>

      {status === "locked" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onUnlock();
          }}
        >
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            PIN
            <input
              type="password"
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm font-normal border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-900"
            />
          </label>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy || !oldPin}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      )}

      {status === "ready" && mode === "none" && (
        <div className="flex flex-wrap gap-2">
          {!pinProtected && (
            <button
              type="button"
              onClick={() => setMode("set")}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50"
            >
              Set PIN
            </button>
          )}
          {pinProtected && (
            <>
              <button
                type="button"
                onClick={() => setMode("change")}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50"
              >
                Change PIN
              </button>
              <button
                type="button"
                onClick={() => setMode("remove")}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/30"
              >
                Remove PIN
              </button>
            </>
          )}
        </div>
      )}

      {status === "ready" && mode === "set" && (
        <PinForm
          title="Set PIN"
          fields={[
            { label: "New PIN", value: newPin, setter: setNewPin },
            { label: "Confirm PIN", value: confirmPin, setter: setConfirmPin },
          ]}
          error={error}
          busy={busy}
          onSubmit={onSetPin}
          onCancel={resetForm}
        />
      )}

      {status === "ready" && mode === "change" && (
        <PinForm
          title="Change PIN"
          fields={[
            { label: "Current PIN", value: oldPin, setter: setOldPin },
            { label: "New PIN", value: newPin, setter: setNewPin },
            { label: "Confirm new PIN", value: confirmPin, setter: setConfirmPin },
          ]}
          error={error}
          busy={busy}
          onSubmit={onChangePin}
          onCancel={resetForm}
        />
      )}

      {status === "ready" && mode === "remove" && (
        <PinForm
          title="Remove PIN"
          fields={[{ label: "Current PIN", value: oldPin, setter: setOldPin }]}
          error={error}
          busy={busy}
          onSubmit={onRemovePin}
          onCancel={resetForm}
          confirmLabel="Remove PIN"
          danger
        />
      )}
    </div>
  );
}

interface PinFormProps {
  title: string;
  fields: { label: string; value: string; setter: (v: string) => void }[];
  error: string | null;
  busy: boolean;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}

function PinForm({ title, fields, error, busy, onSubmit, onCancel, confirmLabel, danger }: PinFormProps) {
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
      {fields.map((f) => (
        <label key={f.label} className="block text-xs text-neutral-500 dark:text-neutral-400">
          {f.label}
          <input
            type="password"
            value={f.value}
            onChange={(e) => f.setter(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-900"
          />
        </label>
      ))}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className={
            danger
              ? "inline-flex items-center px-3 py-2 text-xs font-medium rounded-lg bg-red-600 text-white disabled:opacity-50"
              : "inline-flex items-center px-3 py-2 text-xs font-medium rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50"
          }
        >
          {busy ? "Working…" : (confirmLabel ?? "Save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
