import { z } from "zod";
import {
  Client,
  isCallToolResult,
  type CallToolResult,
  type ClientOptions,
  type RequestOptions,
  type Transport,
  type Tool,
  type McpSubscription,
  type ServerCapabilities,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplateType,
  type Prompt,
} from "@modelcontextprotocol/client";
import { withAbort } from "@/shared/lib/abortSignals";

// TanStack's public callTool only accepts a signal. Use the SDK at this boundary
// so every call can request progress and allow long-running research to finish.
export interface NativeMCPClient {
  readonly capabilities: ServerCapabilities;
  tools(): Promise<Tool[]>;
  callTool(name: string, args?: Record<string, unknown>, options?: RequestOptions): Promise<CallToolResult>;
  resources(): Promise<Resource[]>;
  resourceTemplates(): Promise<ResourceTemplateType[]>;
  prompts(): Promise<Prompt[]>;
  readResource(uri: string): Promise<ReadResourceResult>;
  close(): Promise<void>;
}

export async function createBrowserMcpClient(options: {
  name: string;
  version: string;
  transport: Transport;
  clientOptions: ClientOptions;
}): Promise<NativeMCPClient> {
  const sdk = new Client(
    { name: options.name, version: options.version },
    {
      ...options.clientOptions,
      versionNegotiation: { mode: "auto" },
    },
  );
  await sdk.connect(options.transport);
  let subscription: McpSubscription | undefined;
  if (sdk.getProtocolEra() === "modern" && sdk.getServerCapabilities()?.tools?.listChanged)
    subscription = await sdk.listen({ toolsListChanged: true }).catch(() => undefined);
  let definitions = new Map<string, Tool>();
  return {
    get capabilities() {
      return sdk.getServerCapabilities() ?? {};
    },
    async tools() {
      const { tools } = await sdk.listTools();
      definitions = new Map(tools.map((tool) => [tool.name, tool]));
      return tools;
    },
    async callTool(name, args, requestOptions) {
      const params = { name, arguments: args };
      if (sdk.getProtocolEra() === "modern" || definitions.get(name)?.execution?.taskSupport !== "required")
        return sdk.callTool(params, { ...requestOptions, allowInputRequired: true });
      // Preserve task-required servers on the 2025 protocol era.
      const signal = AbortSignal.any([
        ...(requestOptions?.signal ? [requestOptions.signal] : []),
        AbortSignal.timeout(requestOptions?.timeout ?? 60_000),
      ]);
      requestOptions = { ...requestOptions, signal };
      const taskSchema = z.looseObject({
        taskId: z.string(),
        status: z.enum(["working", "input_required", "completed", "failed", "cancelled"]),
        pollInterval: z.number().optional(),
      });
      const created = await sdk.request(
        { method: "tools/call", params: { ...params, task: {} } },
        z.looseObject({ task: taskSchema }),
        requestOptions,
      );
      const taskId = created.task.taskId;
      try {
        let task = created.task;
        while (task.status === "working") {
          const delay = () => new Promise<void>((resolve) => setTimeout(resolve, task.pollInterval ?? 1000));
          if (requestOptions?.signal) await withAbort(requestOptions.signal, delay);
          else await delay();
          task = await sdk.request({ method: "tasks/get", params: { taskId } }, taskSchema, requestOptions);
        }
        if (task.status === "input_required") throw new Error(`MCP task "${taskId}" needs input`);
        if (task.status !== "completed") throw new Error(`MCP task "${taskId}" ${task.status}`);
        return await sdk.request(
          { method: "tasks/result", params: { taskId } },
          z.custom<CallToolResult>(isCallToolResult),
          requestOptions,
        );
      } catch (error) {
        void sdk.request({ method: "tasks/cancel", params: { taskId } }, z.looseObject({})).catch(() => {});
        throw error;
      }
    },
    resources: async () => (await sdk.listResources()).resources,
    resourceTemplates: async () => (await sdk.listResourceTemplates()).resourceTemplates,
    prompts: async () => (await sdk.listPrompts()).prompts,
    readResource: (uri) => sdk.readResource({ uri }),
    close: async () => {
      await subscription?.close().catch(() => {});
      await sdk.close();
    },
  };
}
