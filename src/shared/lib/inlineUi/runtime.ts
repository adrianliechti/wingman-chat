import {
  ActionMessageSchema,
  MessageProcessor,
  NodeResolver,
  batchWrite,
  type RendererToAgentMessage,
  type SurfaceModel,
  type Subscription,
} from "@a2ui/web_core/v1_0";
import { A2UI_SDK_VERSION, A2UI_VERSION, catalogs, WINGMAN_CATALOG_ID } from "./catalog.ts";
import { parseMessages, type UiBlock, type UiMessage } from "./protocol.ts";

export interface UiSubmission {
  message: RendererToAgentMessage;
  metadata: { a2uiRendererCapabilities: unknown; a2uiRendererDataModel?: unknown };
}
interface SavedState {
  contract: string;
  messages: string[];
  models: Record<string, unknown>;
}
const CONTRACT = `${A2UI_VERSION}:${A2UI_SDK_VERSION}:${WINGMAN_CATALOG_ID}`;
const STORAGE_PREFIX = "wingman:a2ui:1:";
const STORAGE_INDEX = `${STORAGE_PREFIX}index`;
const MAX_SAVED = 100;
export const EMPTY_UI_SNAPSHOT = {
  revision: 0,
  resolvers: new Map<string, NodeResolver>(),
  errors: new Map<string, string>(),
};

/** One conversation owns one processor. Replaying a transcript never executes RPCs or user actions. */
export class InlineUiRuntime {
  processor: MessageProcessor;
  readonly resolvers = new Map<string, NodeResolver>();
  readonly errors = new Map<string, string>();
  private messageErrors = new Map<string, string>();
  private applied: string[] = [];
  private listeners = new Set<() => void>();
  private subscriptions: Subscription[] = [];
  private revision = 0;
  private snapshot = EMPTY_UI_SNAPSHOT;
  private syncing = false;
  private restored = false;
  private saveTimer?: ReturnType<typeof setTimeout>;
  onSubmit?: (submission: UiSubmission) => void | Promise<void>;

  readonly owner?: string;
  constructor(owner?: string) {
    this.owner = owner;
    this.processor = this.createProcessor();
  }

  private createProcessor(): MessageProcessor {
    const processor = new MessageProcessor(
      catalogs,
      async (action) => {
        const message = ActionMessageSchema.parse({ version: A2UI_VERSION, action });
        if (!this.onSubmit) throw new Error("Sending an action is unavailable here");
        await this.onSubmit({
          message,
          metadata: {
            a2uiRendererCapabilities: processor.getRendererCapabilities({ versions: [A2UI_VERSION] }),
            ...(processor.getRendererDataModel(A2UI_VERSION) && {
              a2uiRendererDataModel: processor.getRendererDataModel(A2UI_VERSION),
            }),
          },
        });
      },
      {
        version: A2UI_VERSION,
        validationConfig: {
          targetVersion: A2UI_VERSION,
          allowUnknownElements: false,
          allowMissingRoot: true,
          allowDanglingReferences: true,
          allowOrphanComponents: true,
          allowedMessages: [
            "createSurface",
            "updateComponents",
            "updateDataModel",
            "deleteSurface",
            "agentFunctionResponse",
          ],
        },
      },
    );
    processor.onSurfaceCreated((surface) => {
      this.subscriptions.push(
        surface.dataModel.subscribe("/", () => {
          if (!this.syncing) this.scheduleSave();
        }),
      );
      this.subscriptions.push(
        surface.onError.subscribe((error) => {
          this.errors.set(surface.id, error.message);
          this.changed();
        }),
      );
      this.resolvers.set(surface.id, new NodeResolver(surface, surface.defaultCatalog));
    });
    processor.onSurfaceDeleted((id) => {
      this.resolvers.get(id)?.dispose();
      this.resolvers.delete(id);
      this.errors.delete(id);
    });
    return processor;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private changed() {
    this.snapshot = { revision: ++this.revision, resolvers: new Map(this.resolvers), errors: new Map(this.errors) };
    for (const listener of this.listeners) listener();
  }

  sync(blocks: readonly UiBlock[]) {
    const entries: { block: string; message: UiMessage; fingerprint: string }[] = [];
    const parseErrors = new Map<string, string>();
    const surfaceErrors = [...this.errors].filter(([key]) => this.resolvers.has(key));
    this.errors.clear();
    for (const [key, error] of surfaceErrors) this.errors.set(key, error);
    for (const [key, error] of this.messageErrors) this.errors.set(key, error);
    for (const block of blocks) {
      const parsed = parseMessages(block.source, block.streaming);
      if (parsed.error) {
        this.errors.set(block.key, parsed.error);
        parseErrors.set(block.key, parsed.error);
      }
      for (const message of parsed.messages)
        entries.push({ block: block.key, message, fingerprint: JSON.stringify([block.key, message]) });
    }
    if (entries.length > 3000) {
      this.errors.set("session", "Too many UI messages in this conversation");
      this.changed();
      return;
    }
    const fingerprints = entries.map((entry) => entry.fingerprint);
    const append = this.applied.length <= entries.length && this.applied.every((value, i) => value === fingerprints[i]);
    if (!append) {
      this.flush();
      this.clearProcessor();
      this.processor = this.createProcessor();
      this.applied = [];
      this.messageErrors.clear();
      this.errors.clear();
      for (const [key, error] of parseErrors) this.errors.set(key, error);
      this.restored = false;
    }
    const saved = !this.restored ? this.readSaved(fingerprints) : undefined;
    this.syncing = true;
    try {
      batchWrite(() => {
        for (let i = this.applied.length; i < entries.length; i++) {
          const entry = entries[i];
          try {
            // Fences are a persisted UI log, never an imperative RPC execution channel.
            if ("callRendererFunction" in entry.message)
              throw new Error(
                "Renderer RPC is not supported in persisted UI fences; use a user-activated component action",
              );
            const operation =
              "updateDataModel" in entry.message
                ? entry.message.updateDataModel
                : "updateComponents" in entry.message
                  ? entry.message.updateComponents
                  : undefined;
            // Binding errors can be temporary while a streaming data model arrives.
            if (operation) this.errors.delete(operation.surfaceId);
            this.processor.processMessages(entry.message);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.errors.set(entry.block, message);
            this.messageErrors.set(entry.block, message);
          }
          this.applied.push(entry.fingerprint);
          if (saved && i + 1 === saved.messages.length) {
            for (const [id, data] of Object.entries(saved.models))
              this.processor.getSurface(id)?.dataModel.set("/", data);
          }
        }
      });
      // The candidate SDK reports intermediate missing dependencies while
      // installing nested reactive functions. Recheck only affected surfaces
      // against the settled data model so repaired errors do not linger.
      for (const [id, surface] of this.processor.getSurfaces()) {
        if (!this.errors.has(id)) continue;
        this.errors.delete(id);
        const probe = new NodeResolver(surface, surface.defaultCatalog);
        probe.dispose();
      }
      this.restored = true;
    } finally {
      this.syncing = false;
    }
    this.changed();
  }

  getSurface(id: string): SurfaceModel | undefined {
    return this.processor.getSurface(id);
  }

  private readSaved(messages: string[]): SavedState | undefined {
    if (!this.owner) return;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + this.owner);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedState;
      if (
        saved.contract !== CONTRACT ||
        !Array.isArray(saved.messages) ||
        !saved.messages.length ||
        !saved.models ||
        typeof saved.models !== "object"
      )
        return;
      if (saved.messages.length > messages.length || !saved.messages.every((value, i) => value === messages[i])) return;
      return saved;
    } catch {
      return;
    }
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 150);
  }
  flush() {
    clearTimeout(this.saveTimer);
    if (!this.owner || !this.applied.length) return;
    try {
      const saved: SavedState = {
        contract: CONTRACT,
        messages: this.applied,
        models: Object.fromEntries(
          [...this.processor.getSurfaces()].map(([id, surface]) => [id, surface.dataModel.get("/")]),
        ),
      };
      const serialized = JSON.stringify(saved);
      if (serialized.length > 1_000_000) return;
      localStorage.setItem(STORAGE_PREFIX + this.owner, serialized);
      const previous: unknown = JSON.parse(localStorage.getItem(STORAGE_INDEX) ?? "[]");
      const index = [
        this.owner,
        ...(Array.isArray(previous)
          ? previous.filter((key): key is string => typeof key === "string" && key !== this.owner)
          : []),
      ];
      for (const key of index.slice(MAX_SAVED)) localStorage.removeItem(STORAGE_PREFIX + key);
      localStorage.setItem(STORAGE_INDEX, JSON.stringify(index.slice(0, MAX_SAVED)));
    } catch {
      /* Storage may be unavailable or full; interaction remains usable. */
    }
  }
  private clearProcessor() {
    for (const resolver of this.resolvers.values()) resolver.dispose();
    this.resolvers.clear();
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.subscriptions = [];
    this.processor.dispose();
  }
  dispose() {
    this.flush();
    this.clearProcessor();
    this.listeners.clear();
  }
}
