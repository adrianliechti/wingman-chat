import { ChevronDown, CloudOff, Download, EllipsisVertical, Lock, Power, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as storeSession from "@/shared/lib/storeSession";
import { supportsPasskeys } from "@/shared/lib/passkey";
import { notify } from "@/shared/lib/notify";
import { confirm } from "@/shared/lib/confirm";
import { requestBackupReset } from "@/shared/lib/backupReset";
import { type SyncHealth, useSyncStatus } from "../hooks/useSyncStatus";
import { BackupSetup, type BackupSetupStep } from "./BackupSetup";
import { BackupRecoveryMethods } from "./BackupRecoveryMethods";
import { BackupStatusIcon } from "./BackupStatusIcon";
import { PinForm } from "./PinForm";
import { readLocalMirror } from "@/shared/lib/chatSync";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";

import { getBackupSize } from "@/shared/lib/storeClient";
import { formatBytes } from "@/shared/lib/utils";

const PIN_MIN_LEN = 4;
const PIN_MAX_LEN = 32;

const ACTIVE_BACKUP_DESCRIPTIONS = {
  error: "Changes are saved on this device. Try syncing again.",
  pending: "Changes are saved here and will back up when connected.",
  "upload-only": "Backing up automatically. Unlock to sync other devices.",
};

const BACKUP_HEALTH_TITLES: Partial<Record<SyncHealth, string>> = {
  synced: "Everything looks fine",
  syncing: "Backing up changes",
  pending: "Waiting to back up",
  error: "Backup needs attention",
  "upload-only": "Backup is running",
};

interface SyncSectionProps {
  showHeading?: boolean;
  renderHeader?: (actions: ReactNode) => ReactNode;
  children?: ReactNode;
  dangerActions?: ReactNode;
  dangerDisabled?: boolean;
}

export function SyncSection({
  children,
  dangerActions,
  dangerDisabled = false,
  showHeading = true,
  renderHeader,
}: SyncSectionProps) {
  const {
    session: status,
    health: syncHealth,
    pendingCount,
    lastSyncAt,
    lastError,
    pinProtected,
    passkeyProtected,
    remembered,
  } = useSyncStatus();
  const [backupBytes, setBackupBytes] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (status === "ready" || status === "upload-only") {
      void getBackupSize().then(
        (bytes) => {
          if (!cancelled) setBackupBytes(bytes);
        },
        () => {
          if (!cancelled) setBackupBytes(null);
        },
      );
    } else {
      setBackupBytes(null);
    }
    return () => {
      cancelled = true;
    };
  }, [status, syncHealth, lastSyncAt]);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [hasLocalChats, setHasLocalChats] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void readLocalMirror(false)
      .then((chats) => {
        if (!cancelled) setHasLocalChats(chats.length > 0);
      })
      .catch(() => {
        /* Keep the unlock wording if local storage cannot be read. */
      });
    return () => {
      cancelled = true;
    };
  }, [status]);
  const recovering = !hasLocalChats && status === "locked";
  const unlockLabel = recovering ? "Restore backup" : "Unlock backup";
  const [syncBusy, setSyncBusy] = useState(false);
  const health = syncBusy && syncHealth !== "error" ? "syncing" : syncHealth;

  // Backup setup and PIN form state
  const [setupStep, setSetupStep] = useState<BackupSetupStep>("intro");
  const setupStartRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"none" | "restore" | "set" | "change">("none");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onResetBackup() {
    if (
      !(await confirm({
        title: "Reset backups?",
        message:
          "Permanently delete all online backup data and reset your PIN/passkey protection and backup settings. Local chats and files stay on this browser. Open tabs will reload and active responses will stop. Backups stay off until you set them up again. This cannot be undone.",
        confirmLabel: "Delete online backup and reset",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await requestBackupReset();
    } catch (err) {
      notify.error("Couldn't reset backups", err);
      setBusy(false);
    }
  }

  async function onSyncNow() {
    const startedAt = performance.now();
    setSyncBusy(true);
    try {
      await storeSession.syncNow();
    } catch (err) {
      notify.error("Sync failed", err);
    } finally {
      // Keep fast syncs visible without adding delay to longer syncs.
      const remaining = 1_500 - (performance.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      setSyncBusy(false);
    }
  }

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
      await storeSession.unlock(oldPin);
      resetForm();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn’t restore your backup. Check your PIN and try again.",
      );
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
      await storeSession.setPin(newPin);
      resetForm();
      if (setupStep === "pin") setSetupStep("passkey");
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
      await storeSession.changePin(oldPin, newPin);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change PIN");
    } finally {
      setBusy(false);
    }
  }

  async function onPasskey(action: "unlock" | "set") {
    setError(null);
    setBusy(true);
    try {
      if (action === "unlock") await storeSession.unlockPasskey();
      else await storeSession.setPasskey();
      resetForm();
      if (action === "set" && setupStep === "passkey") setSetupStep("intro");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Passkey request didn’t finish. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const active = status === "ready" || status === "upload-only";
  // Saving the PIN moves the session through locked and ready before the next step is shown.
  const settingUp =
    (setupStep === "pin" && (status === "setup" || busy)) || (status === "ready" && setupStep === "passkey");
  const description = active
    ? health === "error" || health === "pending"
      ? ACTIVE_BACKUP_DESCRIPTIONS[health]
      : status === "upload-only"
        ? ACTIVE_BACKUP_DESCRIPTIONS["upload-only"]
        : ""
    : status === "locked"
      ? recovering
        ? "Restore your online backup to bring your data to this browser."
        : "Backup is off on this browser. Your online copy is kept. Unlock to resume."
      : status === "initializing"
        ? "Checking your backup status. This should only take a moment."
        : "Backups could not connect. Retrying automatically.";

  const lastSynced = lastSyncAt
    ? `Last synced ${new Date(lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Not synced yet";
  const syncSummary = `${syncBusy || health === "syncing" ? "Syncing…" : lastSynced}${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}`;

  const backupMenu = active ? (
    <DropdownMenu
      anchor="bottom end"
      trigger={
        <MenuButton
          type="button"
          disabled={busy}
          aria-label="Backup options"
          title="Backup options"
          className="-mr-2 -my-1 shrink-0 rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <EllipsisVertical size={18} aria-hidden="true" />
        </MenuButton>
      }
    >
      <DropdownMenuItem
        icon={<Power size={14} aria-hidden="true" />}
        onClick={() => {
          setBusy(true);
          void storeSession
            .stopDeviceSync()
            .catch((error) => notify.error("Couldn't deactivate backup", error))
            .finally(() => setBusy(false));
        }}
      >
        Deactivate backup
      </DropdownMenuItem>
    </DropdownMenu>
  ) : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {renderHeader?.(backupMenu)}
      {status !== "disabled" && (
        <section aria-label="Online backup" className="space-y-4">
          {!renderHeader && showHeading && (
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-medium text-neutral-800 dark:text-neutral-100">Online backup</h4>
              {backupMenu}
            </div>
          )}
          {!settingUp && (
            <BackupStatusRow
              icon={
                status === "setup" || status === "locked" ? (
                  <CloudOff size={28} aria-hidden="true" className="shrink-0 text-neutral-500 dark:text-neutral-400" />
                ) : (
                  <BackupStatusIcon health={health} size={28} />
                )
              }
              title={
                active
                  ? (BACKUP_HEALTH_TITLES[health] ?? "Checking your backup")
                  : status === "setup" || status === "locked"
                    ? recovering
                      ? "Ready to restore"
                      : "Backup is off"
                    : status === "error"
                      ? "Backup needs attention"
                      : "Checking your backup"
              }
              size={active && backupBytes !== null ? `≈ ${formatBytes(backupBytes)}` : undefined}
              description={
                status === "setup" ? (
                  "Your data is saved only in this browser. Turn on backup to keep a copy online."
                ) : active ? (
                  <>
                    <span className="block">{syncSummary}</span>
                    {description && <span className="block">{description}</span>}
                  </>
                ) : (
                  description
                )
              }
              actions={
                <>
                  {status === "setup" && setupStep === "intro" && (
                    <button
                      ref={setupStartRef}
                      type="button"
                      disabled={busy}
                      onClick={() => setSetupStep("pin")}
                      className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                    >
                      Turn on backup
                    </button>
                  )}
                  {active && (
                    <button
                      type="button"
                      onClick={() => void onSyncNow()}
                      disabled={syncBusy}
                      className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw size={12} aria-hidden="true" className={syncBusy ? "animate-spin" : undefined} />
                      Sync now
                    </button>
                  )}
                  {(status === "locked" || status === "upload-only") && mode === "none" && (
                    <button
                      type="button"
                      disabled={busy || (passkeyProtected && !supportsPasskeys())}
                      onClick={() => {
                        if (passkeyProtected) void onPasskey("unlock");
                        else {
                          setError(null);
                          setMode("restore");
                        }
                      }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                    >
                      {recovering ? <Download size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
                      {busy ? (recovering ? "Restoring…" : "Unlocking…") : unlockLabel}
                    </button>
                  )}
                </>
              }
            />
          )}
          {active && lastError && <p className="text-xs text-red-600 dark:text-red-400">Sync error: {lastError}</p>}
          {status !== "setup" && (
            <>
              {(status === "locked" || status === "upload-only") && pinProtected && passkeyProtected && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setMode(mode === "restore" ? "none" : "restore");
                  }}
                  className="rounded text-xs font-medium text-neutral-600 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:text-neutral-300"
                >
                  {mode === "restore" ? "Use passkey instead" : "Use PIN instead"}
                </button>
              )}

              {status === "error" && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  Sync initialization failed: {lastError ?? "Unknown error"}. Check your connection. We’ll retry
                  automatically.
                </p>
              )}

              {status === "ready" && !remembered && (
                <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                  This device will need to unlock your backup again next visit.
                </p>
              )}
            </>
          )}
          <section
            aria-label="Backup protection"
            className={settingUp ? "space-y-4" : "space-y-3 border-t border-neutral-100 pt-3 dark:border-neutral-800"}
          >
            {!settingUp && (
              <>
                <h4 className="text-xs font-medium text-neutral-800 dark:text-neutral-100">Backup protection</h4>
                <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  Your chats and files are encrypted on your device before they’re backed up. The backup server can’t
                  read them. Use your PIN or passkey to decrypt and restore your backup.
                </p>
              </>
            )}
            {status === "setup" || settingUp ? (
              <BackupSetup
                step={setupStep}
                onStepChange={setSetupStep}
                startRef={setupStartRef}
                busy={busy}
                error={error}
                pin={newPin}
                confirmation={confirmPin}
                onPinChange={setNewPin}
                onConfirmationChange={setConfirmPin}
                onSetPin={onSetPin}
                onSetPasskey={() => onPasskey("set")}
                onReset={resetForm}
              />
            ) : (
              <>
                {status === "ready" && mode === "none" && (
                  <BackupRecoveryMethods
                    pinProtected={pinProtected}
                    passkeyProtected={passkeyProtected}
                    busy={busy}
                    onAddPin={() => {
                      setError(null);
                      setMode("set");
                    }}
                    onAddPasskey={() => void onPasskey("set")}
                    onChangePin={() => {
                      setError(null);
                      setMode("change");
                    }}
                  />
                )}

                {(status === "ready" || ((status === "locked" || status === "upload-only") && passkeyProtected)) &&
                  !supportsPasskeys() && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Passkeys aren’t available in this browser. Try a supported browser or device.
                    </p>
                  )}
                {error &&
                  mode === "none" &&
                  ((status !== "locked" && status !== "upload-only") || passkeyProtected) && (
                    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                      {error}
                    </p>
                  )}

                {(status === "locked" || status === "upload-only") && mode === "restore" && pinProtected && (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void onUnlock();
                    }}
                  >
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {recovering
                        ? "Enter your PIN to restore your backup."
                        : "Enter your PIN to unlock automatic sync."}
                    </p>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                      PIN
                      <input
                        type="password"
                        autoComplete="current-password"
                        autoFocus
                        disabled={busy}
                        value={oldPin}
                        onChange={(e) => setOldPin(e.target.value)}
                        className="mt-1 w-full px-3 py-2 text-sm font-normal border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-900"
                      />
                    </label>
                    {error && (
                      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                        {error}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={resetForm}
                        disabled={busy}
                        className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={busy || !oldPin}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50"
                      >
                        {busy ? (recovering ? "Restoring…" : "Unlocking…") : unlockLabel}
                      </button>
                    </div>
                  </form>
                )}

                {status === "ready" && mode === "set" && (
                  <PinForm
                    title="Add recovery PIN"
                    description="Choose a long PIN and keep it somewhere you can access without your passkey. Your passkey will keep working."
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
              </>
            )}
          </section>
        </section>
      )}

      {children}

      <section
        aria-labelledby="reset-backup-heading"
        className="mt-auto space-y-3 border-t border-red-200/70 pt-5 dark:border-red-900/40"
      >
        <h4 id="reset-backup-heading">
          <button
            type="button"
            aria-expanded={dangerOpen}
            aria-controls="backup-danger-actions"
            onClick={() => setDangerOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded text-xs font-medium text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-red-400"
          >
            Danger zone
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform ${dangerOpen ? "rotate-180" : ""}`}
            />
          </button>
        </h4>
        <div id="backup-danger-actions" hidden={!dangerOpen} className="space-y-3">
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {dangerActions
              ? "These actions permanently remove data and cannot be undone."
              : "Permanently delete your online backup and start over. Local chats and files are kept. Remove passkeys from your password manager separately."}
          </p>
          {dangerActions && status !== "disabled" && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Resetting your online backup keeps local chats and files. Remove passkeys from your password manager
              separately.
            </p>
          )}
          <fieldset disabled={busy || syncBusy || dangerDisabled} className="flex flex-wrap gap-2">
            {status !== "disabled" && (
              <button
                type="button"
                disabled={busy || syncBusy || dangerDisabled || status === "initializing"}
                onClick={() => void onResetBackup()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <Trash2 size={14} aria-hidden="true" />
                Reset online backup
              </button>
            )}
            {dangerActions}
          </fieldset>
        </div>
      </section>
    </div>
  );
}

interface BackupStatusRowProps {
  icon: ReactNode;
  title: string;
  size?: string;
  description: ReactNode;
  actions: ReactNode;
}

function BackupStatusRow({ icon, title, size, description, actions }: BackupStatusRowProps) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 sm:grid-cols-[28px_minmax(0,1fr)_auto]">
      {icon}
      <div className="min-w-0 space-y-0.5" role="status">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{title}</span>
          {size && (
            <span
              className="text-xs text-neutral-500 dark:text-neutral-400"
              title="Approximate online backup size"
              aria-label={`Approximate online backup size: ${size}`}
            >
              {size}
            </span>
          )}
        </div>
        <div className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</div>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 justify-self-start empty:hidden sm:col-start-3 sm:row-start-1">
        {actions}
      </div>
    </div>
  );
}
