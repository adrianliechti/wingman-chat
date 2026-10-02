import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@/shared/types/chat";

const chat: { model?: string; effort?: Model["effort"]; verbosity?: Model["verbosity"] } = {};
vi.mock("@/shared/config", () => ({ getConfig: () => ({ chat }) }));

const { getConfiguredModel, getDefaultModel } = await import("./useModels");

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const luna: Model = { id: "luna", name: "Luna", supportedEfforts: ["low", "medium", "high"], defaultEffort: "medium" };
const sol: Model = { id: "sol", name: "Sol", replaces: ["retired"] };

describe("getConfiguredModel", () => {
  beforeEach(() => {
    for (const key of Object.keys(chat)) delete chat[key as keyof typeof chat];
    storage.clear();
  });

  it("returns null without a configured or available model", () => {
    expect(getConfiguredModel([luna])).toBeNull();
    chat.model = "missing";
    expect(getConfiguredModel([luna])).toBeNull();
  });

  it("applies the configured effort and verbosity", () => {
    Object.assign(chat, { model: "luna", effort: "low", verbosity: "high" });
    expect(getConfiguredModel([luna])).toEqual({ ...luna, effort: "low", verbosity: "high" });
  });

  it("drops an unsupported effort and resolves replaced ids", () => {
    Object.assign(chat, { model: "luna", effort: "max" });
    expect(getConfiguredModel([luna])?.effort).toBeUndefined();
    chat.model = "retired";
    expect(getConfiguredModel([luna, sol])?.id).toBe("sol");
  });

  it("wins over the saved model for new chats", () => {
    localStorage.setItem("app_model", "sol");
    expect(getDefaultModel([luna, sol])?.id).toBe("sol");
    chat.model = "luna";
    expect(getDefaultModel([luna, sol])?.id).toBe("luna");
  });
});
