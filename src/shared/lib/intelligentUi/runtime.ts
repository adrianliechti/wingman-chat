/**
 * The reactive runtime behind one Intelligent UI document: a TanStack Store
 * holds the bound state, a derived atom recomputes the document's `computed`
 * values whenever state changes, and a small dispatcher runs button actions.
 *
 * The runtime is plain JavaScript with no React dependency; the React renderer
 * subscribes with `useSelector`. Keeping it here means the same document could
 * drive a different renderer, and the state engine can be tested on its own.
 */

import { createAtom, createStore, type ReadonlyAtom, type Store } from "@tanstack/store";
import {
  evaluate,
  ExpressionError,
  isTemplate,
  type JsonValue,
  referencedIdentifiers,
  resolveTemplate,
  type Scope,
  stringify,
  truthy,
} from "./expression";
import { collectBindings, type UiAction, type UiDocument } from "./schema";

export interface ScopeSnapshot {
  /** State and computed values, as expressions see them. */
  values: Scope;
  /** Computed keys that failed to evaluate, with the reason. */
  errors: Record<string, string>;
}

/** What the host application lets a document do beyond its own state. */
export interface ActionHost {
  /** Post text to the chat as the user's next turn. Absent when the host cannot send. */
  sendMessage?: (text: string) => void;
  copyText?: (text: string) => Promise<void> | void;
  openUrl?: (url: string) => void;
  confirm?: (message: string) => Promise<boolean> | boolean;
  /** Surface a short status, e.g. "Copied" or "Sending is not available here". */
  notify?: (message: string, kind: "info" | "error") => void;
}

export interface UiRuntime {
  readonly document: UiDocument;
  readonly state: Store<Scope>;
  readonly scope: ReadonlyAtom<ScopeSnapshot>;
  /** Resolve a prop: templates against the current scope; other values pass through. */
  resolve: (value: unknown, scope?: Scope) => unknown;
  /** A boolean prop (`visible`, `disabled`): booleans as given, strings as templates or bare expressions. */
  condition: (value: unknown, scope?: Scope) => boolean;
  setValue: (key: string, value: unknown) => void;
  reset: (keys?: string[]) => void;
  run: (actions: UiAction[], host: ActionHost) => Promise<void>;
}

/** Order computed values so each sees the ones it references, falling back to declaration order on cycles. */
function orderComputed(computed: UiDocument["computed"]): UiDocument["computed"] {
  const byKey = new Map(computed.map((entry) => [entry.key, entry]));
  const ordered: UiDocument["computed"] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key) || visiting.has(key)) return;
    const entry = byKey.get(key);
    if (!entry) return;
    visiting.add(key);
    for (const dependency of referencedIdentifiers(entry.expression)) {
      if (dependency !== key && byKey.has(dependency)) visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(entry);
  };
  for (const entry of computed) visit(entry.key);
  return ordered;
}

function initialState(document: UiDocument): Scope {
  const state: Scope = { ...document.state };
  // Bound keys the model forgot to declare start as null so controls still work.
  for (const key of collectBindings(document.children)) if (!(key in state)) state[key] = null;
  return state;
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function createUiRuntime(document: UiDocument, saved?: Scope): UiRuntime {
  const computed = orderComputed(document.computed);
  const defaults = initialState(document);
  // Saved values only fill keys the document still declares; a renamed key starts fresh.
  const restored = saved
    ? Object.fromEntries(Object.keys(defaults).map((key) => [key, key in saved ? saved[key] : defaults[key]]))
    : undefined;
  const state = createStore<Scope>(cloneJson(restored ?? defaults));

  const scope = createAtom<ScopeSnapshot>(() => {
    const values: Scope = { ...state.get() };
    const errors: Record<string, string> = {};
    for (const { key, expression } of computed) {
      try {
        values[key] = isTemplate(expression) ? resolveTemplate(expression, values) : evaluate(expression, values);
      } catch (error) {
        values[key] = null;
        errors[key] = error instanceof Error ? error.message : String(error);
      }
    }
    return { values, errors };
  });

  const resolve = (value: unknown, current: Scope = scope.get().values): unknown => {
    if (!isTemplate(value)) return value;
    try {
      return resolveTemplate(value, current);
    } catch (error) {
      if (error instanceof ExpressionError) return `⚠ ${error.message}`;
      throw error;
    }
  };

  const condition = (value: unknown, current: Scope = scope.get().values): boolean => {
    if (typeof value !== "string") return truthy(value);
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
      return truthy(isTemplate(trimmed) ? resolveTemplate(trimmed, current) : evaluate(trimmed, current));
    } catch {
      // A broken condition hides nothing and disables nothing; the renderer reports the expression elsewhere.
      return trimmed === "true";
    }
  };

  const setValue = (key: string, value: unknown) => {
    state.setState((prev) => (Object.is(prev[key], value) ? prev : { ...prev, [key]: value }));
  };

  const reset = (keys?: string[]) => {
    state.setState((prev) => {
      if (!keys) return cloneJson(defaults);
      const next = { ...prev };
      for (const key of keys) next[key] = cloneJson(defaults[key] ?? null) as JsonValue;
      return next;
    });
  };

  const run = async (actions: UiAction[], host: ActionHost) => {
    for (const action of actions) {
      const current = scope.get().values;
      switch (action.type) {
        case "set": {
          const updates: Scope = {};
          for (const [key, raw] of Object.entries(action.values)) updates[key] = resolve(raw, current);
          state.setState((prev) => ({ ...prev, ...updates }));
          break;
        }
        case "reset":
          reset(action.keys);
          break;
        case "send": {
          let message = stringify(resolve(action.message, current)).trim();
          if (!message) break;
          // Attach the bound values so the model sees what the user set, not only the template.
          if (action.context) message += `\n\nCurrent values: ${JSON.stringify(state.get())}`;
          if (host.sendMessage) host.sendMessage(message);
          else host.notify?.("Sending a message is not available here", "error");
          break;
        }
        case "copy": {
          const text = stringify(resolve(action.text, current));
          await host.copyText?.(text);
          host.notify?.("Copied", "info");
          break;
        }
        case "open": {
          const url = stringify(resolve(action.url, current)).trim();
          if (!/^https?:\/\//i.test(url)) {
            host.notify?.("Only http(s) links can be opened", "error");
            break;
          }
          host.openUrl?.(url);
          break;
        }
      }
    }
  };

  return { document, state, scope, resolve, condition, setValue, reset, run };
}

// ── Persistence ────────────────────────────────────────────────────────────

// The user's adjustments survive a reload: each document's state is saved in
// localStorage under a hash of its source, with a bounded index so old
// interfaces age out. Identical documents share saved state, as they share a
// runtime.
const STORAGE_PREFIX = "ui-state:";
const STORAGE_INDEX = "ui-state-index";
const MAX_SAVED = 200;

export function hashSource(source: string): string {
  // FNV-1a, enough to key a few hundred documents.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0") + source.length.toString(16);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function loadSavedState(key: string): Scope | undefined {
  const store = storage();
  if (!store) return undefined;
  try {
    const raw = store.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Scope) : undefined;
  } catch {
    return undefined;
  }
}

function saveState(key: string, value: Scope): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    const index = (JSON.parse(store.getItem(STORAGE_INDEX) ?? "[]") as unknown[]).filter(
      (item): item is string => typeof item === "string" && item !== key,
    );
    index.push(key);
    while (index.length > MAX_SAVED) store.removeItem(STORAGE_PREFIX + (index.shift() as string));
    store.setItem(STORAGE_INDEX, JSON.stringify(index));
  } catch {
    // Quota or private mode: the interface still works for this session.
  }
}

// ── Runtime cache ──────────────────────────────────────────────────────────

// A document's state survives the renderer unmounting (switching chats, a
// parent re-keying its children) by keying runtimes on the fence source. Two
// identical documents share a runtime, which is harmless: they would show the
// same defaults anyway.
const runtimes = new Map<string, UiRuntime>();
const MAX_RUNTIMES = 100;

export function getUiRuntime(source: string, document: UiDocument): UiRuntime {
  const existing = runtimes.get(source);
  if (existing) {
    runtimes.delete(source);
    runtimes.set(source, existing);
    return existing;
  }
  const key = hashSource(source);
  const runtime = createUiRuntime(document, loadSavedState(key));
  let timer: ReturnType<typeof setTimeout> | undefined;
  runtime.state.subscribe((value) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveState(key, value), 300);
  });
  runtimes.set(source, runtime);
  while (runtimes.size > MAX_RUNTIMES) runtimes.delete(runtimes.keys().next().value as string);
  return runtime;
}
