import type { Message } from "../types/chat";

export type AgentRunStatus = "completed" | "aborted" | "failed" | "max_turns";
export type AgentRunStopReason = "end_turn" | "abort" | "error" | "max_turns";

interface RunEventBase {
  runId: string;
  invocationId: string;
  sequence: number;
  at: string;
  branch?: string;
}

export type AgentRunEvent =
  | (RunEventBase & { type: "run.started" })
  | (RunEventBase & { type: "compaction.started" | "compaction.completed"; turn: number })
  | (RunEventBase & { type: "model.started" | "model.streaming" | "model.completed"; turn: number })
  | (RunEventBase & { type: "verification.started" | "verification.completed"; turn: number })
  | (RunEventBase & {
      type: "tool.started" | "tool.updated" | "tool.completed";
      turn: number;
      callId: string;
      name: string;
    })
  | (RunEventBase & {
      type: "run.completed";
      status: AgentRunStatus;
      reason: AgentRunStopReason;
    });

export interface AgentRunError {
  code: string;
  message: string;
}

export interface AgentRunResult {
  runId: string;
  status: AgentRunStatus;
  stopReason: AgentRunStopReason;
  messages: Message[];
  startedAt: string;
  endedAt: string;
  checkpoint: AgentRunCheckpoint;
  error?: AgentRunError;
}

export interface AgentRunCheckpoint {
  schemaVersion: "1.0";
  invocationId: string;
  runId: string;
  branch?: string;
  status: AgentRunStatus;
  stopReason: AgentRunStopReason;
  startedAt: string;
  endedAt: string;
  modelCalls: { used: number; limit: number | null };
  messages: Message[];
}

interface SharedInvocationBudget {
  used: number;
  limit: number | null;
}

/** One user invocation shared by a root run and all nested agent branches. */
export class AgentInvocationContext {
  readonly invocationId: string;
  readonly branch?: string;
  readonly signal?: AbortSignal;
  private readonly budget: SharedInvocationBudget;

  constructor(
    options: {
      invocationId?: string;
      branch?: string;
      signal?: AbortSignal;
      maxModelCalls?: number | null;
      budget?: SharedInvocationBudget;
    } = {},
  ) {
    this.invocationId = options.invocationId ?? crypto.randomUUID();
    this.branch = options.branch;
    this.signal = options.signal;
    this.budget = options.budget ?? { used: 0, limit: options.maxModelCalls ?? null };
  }

  fork(name: string): AgentInvocationContext {
    return new AgentInvocationContext({
      invocationId: this.invocationId,
      branch: this.branch ? `${this.branch}.${name}` : name,
      signal: this.signal,
      budget: this.budget,
    });
  }

  tryConsumeModelCall(): boolean {
    if (this.budget.limit != null && this.budget.used >= this.budget.limit) return false;
    this.budget.used++;
    return true;
  }

  budgetSnapshot(): { used: number; limit: number | null } {
    return { ...this.budget };
  }
}

type EventInput = AgentRunEvent extends infer Event
  ? Event extends AgentRunEvent
    ? Omit<Event, keyof RunEventBase>
    : never
  : never;

/** Small framework-independent state owner for one invocation of the agent loop. */
export class AgentRunController {
  readonly runId: string;
  readonly startedAt: string;
  readonly invocation: AgentInvocationContext;

  private readonly onEvent?: (event: AgentRunEvent) => void;
  private finished = false;
  private result?: AgentRunResult;
  private sequence = 0;

  constructor(
    options: {
      runId?: string;
      invocation?: AgentInvocationContext;
      onEvent?: (event: AgentRunEvent) => void;
    } = {},
  ) {
    this.runId = options.runId ?? crypto.randomUUID();
    this.invocation = options.invocation ?? new AgentInvocationContext();
    this.startedAt = new Date().toISOString();
    this.onEvent = options.onEvent;
    this.emit({ type: "run.started" });
  }

  emit(event: EventInput): void {
    if (this.finished) return;
    this.onEvent?.({
      ...event,
      runId: this.runId,
      invocationId: this.invocation.invocationId,
      sequence: this.sequence++,
      at: new Date().toISOString(),
      ...(this.invocation.branch ? { branch: this.invocation.branch } : {}),
    } as AgentRunEvent);
  }

  finish(
    status: AgentRunStatus,
    stopReason: AgentRunStopReason,
    messages: Message[],
    error?: AgentRunError,
  ): AgentRunResult {
    if (this.result) return this.result;
    this.emit({ type: "run.completed", status, reason: stopReason });
    this.finished = true;
    const endedAt = new Date().toISOString();
    const checkpoint: AgentRunCheckpoint = {
      schemaVersion: "1.0",
      invocationId: this.invocation.invocationId,
      runId: this.runId,
      ...(this.invocation.branch ? { branch: this.invocation.branch } : {}),
      status,
      stopReason,
      startedAt: this.startedAt,
      endedAt,
      modelCalls: this.invocation.budgetSnapshot(),
      messages,
    };
    this.result = {
      runId: this.runId,
      status,
      stopReason,
      messages,
      startedAt: this.startedAt,
      endedAt,
      checkpoint,
      ...(error ? { error } : {}),
    };
    return this.result;
  }
}
