/**
 * The reactive runtime behind one Intelligent UI document: a TanStack Store
 * holds the bound state, a derived atom recomputes the document's `computed`
 * values whenever state changes, and a small dispatcher runs button actions.
 *
 * The runtime is plain JavaScript with no React dependency; the React renderer
 * subscribes with `useSelector`. Keeping it here means the same document could
 * drive a different renderer, and the state engine can be tested on its own.
 */

import { debounce } from "@tanstack/pacer";
import { createAtom, createStore, type ReadonlyAtom, type Store } from "@tanstack/store";
import {
  evaluate,
  ExpressionError,
  extendScope,
  isTemplate,
  type JsonValue,
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
  /** Run button actions; `extra` adds iteration values (`item`, `index`) to what templates see. */
  run: (actions: UiAction[], host: ActionHost, extra?: Scope) => Promise<void>;
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
  const defaults = initialState(document);
  // Saved values only fill keys the document still declares; a renamed key starts fresh.
  const restored = saved
    ? Object.fromEntries(Object.keys(defaults).map((key) => [key, key in saved ? saved[key] : defaults[key]]))
    : undefined;
  const state = createStore<Scope>(cloneJson(restored ?? defaults));

  const scope = createAtom<ScopeSnapshot>(() => {
    const values: Scope = { ...state.get() };
    const errors: Record<string, string> = {};
    const evaluating = new Set<string>();
    // Resolve dependencies when they are read, including inside map/filter
    // expressions supplied by state. Each result replaces its getter so it
    // is evaluated only once per state snapshot.
    for (const { key, expression } of document.computed) {
      Object.defineProperty(values, key, {
        configurable: true,
        enumerable: true,
        get: () => {
          if (evaluating.has(key)) throw new ExpressionError(`Circular computed dependency: ${key}`);
          evaluating.add(key);
          let value: unknown = null;
          try {
            value = isTemplate(expression) ? resolveTemplate(expression, values) : evaluate(expression, values);
            return value;
          } catch (error) {
            errors[key] = error instanceof Error ? error.message : String(error);
            throw error;
          } finally {
            evaluating.delete(key);
            Object.defineProperty(values, key, { value, writable: true, configurable: true, enumerable: true });
          }
        },
      });
    }
    // Publish ordinary values and all errors, never lazy getters, to the UI.
    for (const { key } of document.computed) {
      try {
        void values[key];
      } catch {
        // The getter recorded the error and replaced itself with null.
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

  const run = async (actions: UiAction[], host: ActionHost, extra?: Scope) => {
    for (const action of actions) {
      // Re-read after every action so a `set` followed by a `send` carries the new values.
      const current = extra ? extendScope(scope.get().values, extra) : scope.get().values;
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
          if (!host.copyText) {
            host.notify?.("Copying text is not available here", "error");
            return;
          }
          const text = stringify(resolve(action.text, current));
          await host.copyText(text);
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
  runtime.state.subscribe(debounce((value: Scope) => saveState(key, value), { wait: 300 }));
  runtimes.set(source, runtime);
  while (runtimes.size > MAX_RUNTIMES) runtimes.delete(runtimes.keys().next().value as string);
  return runtime;
}
