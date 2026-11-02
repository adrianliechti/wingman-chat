import { ChevronDown, EllipsisVertical, Download, KeyRound, Lock, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import * as storeSession from "@/shared/lib/storeSession";
import { supportsPasskeys } from "@/shared/lib/passkey";
import { notify } from "@/shared/lib/notify";
import { confirm } from "@/shared/lib/confirm";
import { requestBackupReset } from "@/shared/lib/backupReset";
import { type SessionStatus, type SyncHealth, useSyncStatus } from "../hooks/useSyncStatus";
import { BackupSetup } from "./BackupSetup";
import { BackupStatusIcon } from "./BackupStatusIcon";
import { PinForm } from "./PinForm";
import { readLocalMirror } from "@/shared/lib/chatSync";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";

const PIN_MIN_LEN = 4;
const PIN_MAX_LEN = 32;

const ACTIVE_BACKUP_DESCRIPTIONS = {
  error: "Changes are saved on this device. Try syncing again.",
  syncing: "Your latest changes are backed up automatically.",
  pending: "Changes are saved here and will back up when connected.",
  "upload-only": "Backing up automatically. Unlock to sync other devices.",
  ready: "Your latest changes are backed up automatically.",
};

/** Overlapping alternatives reserve their natural wrapped height at every width. */
function StableStatusText({ text, alternatives }: { text: string; alternatives: string[] }) {
  return (
    <span className="grid min-w-0">
      {[...new Set([text, ...alternatives])].map((value) => (
        <span
          key={value}
          className={`col-start-1 row-start-1 ${value === text ? "" : "invisible"}`}
          aria-hidden={value !== text}
        >
          {value}
        </span>
      ))}
    </span>
  );
}

function statusLabel(s: SessionStatus, health: SyncHealth): string {
  if (s === "ready" || s === "upload-only") {
    if (health === "error") return "Needs attention";
    if (health === "syncing") return "Backing up…";
    if (health === "pending") return "Waiting to back up";
  }
  switch (s) {
    case "disabled":
      return "Server sync disabled";
    case "initializing":
      return "Connecting…";
    case "setup":
      return "Off";
    case "locked":
      return "Locked";
    case "upload-only":
      return "On";
    case "ready":
      return "Up to date";
    case "error":
      return "Connection issue";
  }
}

interface SyncSectionProps {
  children?: ReactNode;
  dangerActions?: ReactNode;
  dangerDisabled?: boolean;
}

export function SyncSection({ children, dangerActions, dangerDisabled = false }: SyncSectionProps) {
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
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Passkey request didn’t finish. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const active = status === "ready" || status === "upload-only";
  const description = active
    ? ACTIVE_BACKUP_DESCRIPTIONS[
        health === "error" || health === "syncing" || health === "pending"
          ? health
          : status === "upload-only"
            ? "upload-only"
            : "ready"
      ]
    : status === "locked"
      ? recovering
        ? "Restore your online backup to bring your data to this browser."
        : "Unlock your backup to sync changes from your other devices."
      : status === "initializing"
        ? "Checking your backup status. This should only take a moment."
        : "Backups could not connect. Retrying automatically.";

  return (
    <div className="flex flex-1 flex-col gap-4">
      {status !== "disabled" && (
        <section aria-label="Online backup" className="space-y-4">
          {status === "setup" ? (
            <BackupSetup
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
              <div
                className={
                  status === "ready" ? "flex items-start gap-3" : "flex flex-col gap-3 sm:flex-row sm:items-start"
                }
              >
                <div className="min-w-0 flex-1 space-y-2" role="status">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <h4 className="text-xs font-medium text-neutral-800 dark:text-neutral-100">Online backup</h4>
                    <span
                      className={
                        (status === "ready" && health === "synced") || health === "syncing"
                          ? "sr-only"
                          : `inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${status === "error" || health === "error" ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300" : active && health !== "pending" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"}`
                      }
                    >
                      <StableStatusText
                        text={recovering ? "Ready to restore" : statusLabel(status, health)}
                        alternatives={
                          active
                            ? (["synced", "upload-only", "syncing", "pending", "error"] satisfies SyncHealth[]).map(
                                (state) => statusLabel(status, state),
                              )
                            : []
                        }
                      />
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                    <StableStatusText
                      text={description}
                      alternatives={active ? Object.values(ACTIVE_BACKUP_DESCRIPTIONS) : []}
                    />
                  </p>
                </div>
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
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                  >
                    <Download size={14} aria-hidden="true" />
                    {busy ? (recovering ? "Restoring…" : "Unlocking…") : unlockLabel}
                  </button>
                )}
                {status === "ready" && mode === "none" && (
                  <DropdownMenu
                    anchor="bottom end"
                    trigger={
                      <MenuButton
                        type="button"
                        disabled={busy}
                        aria-label="Backup options"
                        title="Backup options"
                        className="-mr-1 -mt-1 shrink-0 rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                      >
                        <EllipsisVertical size={18} aria-hidden="true" />
                      </MenuButton>
                    }
                  >
                    <DropdownMenuItem
                      icon={<KeyRound size={14} aria-hidden="true" />}
                      disabled={!supportsPasskeys()}
                      onClick={() => void onPasskey("set")}
                    >
                      {passkeyProtected ? "Replace passkey" : pinProtected ? "Switch to passkey" : "Use passkey"}
                    </DropdownMenuItem>
                    {!pinProtected && (
                      <DropdownMenuItem icon={<Lock size={14} aria-hidden="true" />} onClick={() => setMode("set")}>
                        {passkeyProtected ? "Switch to PIN" : "Set PIN"}
                      </DropdownMenuItem>
                    )}
                    {remembered && (
                      <DropdownMenuItem
                        icon={<Lock size={14} aria-hidden="true" />}
                        onClick={() => {
                          setBusy(true);
                          void storeSession
                            .stopDeviceSync()
                            .catch((error) => notify.error("Couldn't stop sync on this device", error))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Stop sync on this device
                      </DropdownMenuItem>
                    )}
                    {pinProtected && (
                      <DropdownMenuItem icon={<Lock size={14} aria-hidden="true" />} onClick={() => setMode("change")}>
                        Change PIN
                      </DropdownMenuItem>
                    )}
                  </DropdownMenu>
                )}
              </div>

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

              {(status === "ready" || status === "upload-only") && (
                <SyncStatusRow
                  icon={<BackupStatusIcon health={health} size={16} />}
                  syncing={syncBusy || health === "syncing"}
                  pendingCount={pendingCount}
                  lastSyncAt={lastSyncAt}
                  lastError={lastError}
                  busy={syncBusy}
                  onSync={() => void onSyncNow()}
                />
              )}

              {(status === "ready" || ((status === "locked" || status === "upload-only") && passkeyProtected)) &&
                !supportsPasskeys() && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Passkeys aren’t available in this browser. Try a supported browser or device.
                  </p>
                )}
              {error && mode === "none" && ((status !== "locked" && status !== "upload-only") || passkeyProtected) && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              {(status === "locked" || status === "upload-only") && mode === "restore" && !passkeyProtected && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onUnlock();
                  }}
                >
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {recovering ? "Enter your PIN to restore your backup." : "Enter your PIN to unlock automatic sync."}
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
                  title={passkeyProtected ? "Switch from passkey to PIN" : "Set PIN"}
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
          <div
            className={`flex items-start gap-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400 ${status === "setup" ? "" : "border-t border-neutral-100 pt-3 dark:border-neutral-800"}`}
          >
            <Lock size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p>
              <span className="font-medium text-neutral-600 dark:text-neutral-300">Encrypted on your device.</span> Use
              your {passkeyProtected ? "passkey" : pinProtected ? "PIN" : "PIN or passkey"} to unlock your backup.
            </p>
          </div>
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

interface SyncStatusRowProps {
  icon: ReactNode;
  syncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  busy: boolean;
  onSync: () => void;
}

function SyncStatusRow({ icon, syncing, pendingCount, lastSyncAt, lastError, busy, onSync }: SyncStatusRowProps) {
  const lastSynced = lastSyncAt
    ? `Last synced ${new Date(lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Not synced yet";
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <span className="inline-flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {icon}
          <StableStatusText
            text={`${syncing ? "Syncing…" : lastSynced}${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}`}
            alternatives={[lastSynced]}
          />
        </span>
        <button
          type="button"
          onClick={onSync}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={12} aria-hidden="true" className={busy ? "animate-spin" : undefined} />
          Sync now
        </button>
      </div>
      {lastError && <p className="text-xs text-red-600 dark:text-red-400">Sync error: {lastError}</p>}
    </>
  );
}
