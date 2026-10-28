import { useCallback, useEffect, useRef, useState } from "react";
import { MCPClient } from "@/features/settings/lib/mcp";
import { sameMcpServer, type McpServerDefinition } from "@/features/settings/lib/mcpConfig";
import { connectMcpWithRetry } from "@/features/settings/lib/mcpRetry";
import { ProviderState } from "@/shared/types/chat";

interface Entry {
  definition: McpServerDefinition;
  client: MCPClient;
  state: ProviderState;
  attempt?: { controller: AbortController; promise: Promise<void> };
}

function release(entry: Entry) {
  entry.attempt?.controller.abort();
  entry.attempt = undefined;
  entry.client.onDisconnected = null;
  entry.client.onAuthenticating = null;
  entry.client.onAuthComplete = null;
  entry.client.onToolsChanged = null;
  void entry.client.disconnect().catch(console.error);
}

/** The sole owner of MCP clients, callbacks, retries, and connection disposal. */
export function useMcpClients(servers: readonly McpServerDefinition[], desired: ReadonlySet<string>) {
  const entries = useRef(new Map<string, Entry>());
  const [snapshot, setSnapshot] = useState<{ clients: MCPClient[]; states: Map<string, ProviderState> }>({
    clients: [],
    states: new Map(),
  });
  const publish = useCallback(() => {
    const current = [...entries.current.values()];
    setSnapshot({
      clients: current.map((entry) => entry.client),
      states: new Map(current.map((entry) => [entry.client.id, entry.state])),
    });
  }, []);

  useEffect(() => {
    const definitions = new Map(servers.map((server) => [server.id, server]));
    for (const [id, entry] of entries.current) {
      const next = definitions.get(id);
      if (!next || !sameMcpServer(entry.definition, next)) {
        entries.current.delete(id);
        release(entry);
      }
    }
    for (const [id, definition] of definitions) {
      if (entries.current.has(id)) continue;
      const client = new MCPClient(
        id,
        definition.url,
        definition.name,
        definition.description,
        definition.headers,
        definition.icon,
        definition.approval,
      );
      const entry: Entry = { definition, client, state: ProviderState.Disconnected };
      entries.current.set(id, entry);
      const update = (state?: ProviderState) => {
        if (entries.current.get(id) !== entry) return;
        if (state !== undefined) entry.state = state;
        publish();
      };
      client.onDisconnected = () => update(client.isAuthBlocked() ? ProviderState.Unauthorized : ProviderState.Failed);
      client.onAuthenticating = () => update(ProviderState.Authenticating);
      client.onAuthComplete = () => update(client.isConnected() ? ProviderState.Connected : ProviderState.Initializing);
      client.onToolsChanged = () => update();
    }
    publish();
  }, [servers, publish]);

  const setConnected = useCallback(
    async (id: string, enabled: boolean, interactive = false) => {
      const entry = entries.current.get(id);
      if (!entry) return;
      if (!enabled) {
        if (entry.state === ProviderState.Disconnected && !entry.attempt) return;
        entry.attempt?.controller.abort();
        entry.attempt = undefined;
        entry.state = ProviderState.Disconnected;
        publish();
        await entry.client.disconnect();
        return;
      }
      if (entry.attempt) return entry.attempt.promise;
      if (entry.client.isConnected()) return;
      if (!interactive && entry.state === ProviderState.Failed) return;
      if (interactive) entry.client.armInteractiveAuth();
      else if (entry.state === ProviderState.Unauthorized || entry.client.isAuthBlocked()) {
        entry.state = ProviderState.Unauthorized;
        publish();
        return;
      }
      const controller = new AbortController();
      entry.state = ProviderState.Initializing;
      publish();
      const promise = connectMcpWithRetry(entry.client, controller.signal, (state) => {
        if (controller.signal.aborted || entries.current.get(id) !== entry) return;
        entry.state = state;
        publish();
      }).finally(() => {
        if (entry.attempt?.controller === controller) entry.attempt = undefined;
      });
      entry.attempt = { controller, promise };
      return promise;
    },
    [publish],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const [id, entry] of entries.current) {
        // Failures require an explicit retry, not a rerender or a tools notification.
        if (desired.has(id) && (entry.state === ProviderState.Failed || entry.state === ProviderState.Unauthorized))
          continue;
        void setConnected(id, desired.has(id)).catch(console.error);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [servers, desired, setConnected]);

  useEffect(() => {
    const managed = entries.current;
    return () => {
      const released = [...managed.values()];
      managed.clear();
      for (const entry of released) release(entry);
    };
  }, []);

  const getClient = useCallback((id: string) => entries.current.get(id)?.client, []);
  const getState = useCallback(
    (id: string) => snapshot.states.get(id) ?? ProviderState.Disconnected,
    [snapshot.states],
  );
  return { clients: snapshot.clients, getClient, getState, setConnected };
}
