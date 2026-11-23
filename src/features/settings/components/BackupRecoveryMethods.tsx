import { KeyRound, Lock } from "lucide-react";
import { supportsPasskeys } from "@/shared/lib/passkey";

interface BackupRecoveryMethodsProps {
  pinProtected: boolean;
  passkeyProtected: boolean;
  busy: boolean;
  onAddPin: () => void;
  onAddPasskey: () => void;
  onChangePin: () => void;
}

export function BackupRecoveryMethods({
  pinProtected,
  passkeyProtected,
  busy,
  onAddPin,
  onAddPasskey,
  onChangePin,
}: BackupRecoveryMethodsProps) {
  const complete = pinProtected && passkeyProtected;
  const passkeysAvailable = supportsPasskeys();
  const methods = [
    {
      name: "Passkey",
      description: "Device or password manager",
      Icon: KeyRound,
      ready: passkeyProtected,
      action: "Add passkey",
      manageAction: "Replace passkey",
      manageLabel: "Replace",
      onManage: onAddPasskey,
      onAdd: onAddPasskey,
      disabled: busy || !passkeysAvailable,
    },
    {
      name: "PIN",
      description: "A code you keep somewhere safe",
      Icon: Lock,
      ready: pinProtected,
      action: "Add recovery PIN",
      manageAction: "Change PIN",
      manageLabel: "Change",
      onManage: onChangePin,
      onAdd: onAddPin,
      disabled: busy,
    },
  ];
  return (
    <section aria-label="Backup recovery methods" className="space-y-2">
      {complete && (
        <h5 className="text-xs font-medium text-neutral-800 dark:text-neutral-100">Two ways to unlock your backup</h5>
      )}
      <ul>
        {methods.map(
          ({ name, description, Icon, ready, action, onAdd, disabled, manageAction, manageLabel, onManage }) => (
            <li key={name} className="grid grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-x-2.5 py-2">
              <Icon size={14} aria-hidden="true" className="text-neutral-500 dark:text-neutral-400" />
              <div className="min-w-0 space-y-0.5">
                <span className="block text-xs font-medium text-neutral-800 dark:text-neutral-100">{name}</span>
                <span className="block text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {description}
                </span>
              </div>
              {ready ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onManage}
                  aria-label={manageAction}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {manageLabel}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onAdd}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                >
                  {action}
                </button>
              )}
            </li>
          ),
        )}
      </ul>
      {!passkeyProtected && !passkeysAvailable && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Add a passkey from a supported browser or device. Your PIN will keep working.
        </p>
      )}
    </section>
  );
}
