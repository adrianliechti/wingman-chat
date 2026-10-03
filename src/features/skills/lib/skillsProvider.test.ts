import { convertSchemaToJsonSchema } from "@tanstack/ai";
import { toolCallMessage } from "@/shared/lib/test-support/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALREADY_LOADED } from "@tanstack/ai-skills";
import { mountSkillFiles, setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { run } from "@/shared/lib/agent";
import { Client } from "@/shared/lib/client";
import { testClient, response, callItem, textItem, finished } from "@/shared/lib/test-support/ai";
import { assistantMessage, userMessage } from "@/shared/lib/messages";
import { createSkillsProvider } from "./skillsProvider";

afterEach(() => {
  setSkillResourceResolver("test-skills", null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const meta = { id: "test-skills", name: "Skills", description: "Fixture" };
const skill = {
  name: "reports",
  description: "Create reports",
  compatibility: "Browser Python",
  loadContent: () => "---\nname: reports\ndescription: Create reports\n---\nVerify the report.",
  resources: ["scripts/check.py"],
  loadResource: () => "print('ok')",
};
const prompt = [userMessage("Write a report")];
const done = assistantMessage("Done");
const call = (id: string, name: string, args: object) =>
  toolCallMessage([{ id, name, arguments: JSON.stringify(args) }]);

describe("native skills", () => {
  it("uses one winning entry for duplicate names across the voice catalog, loader, and mounts", async () => {
    const loadContent = vi.fn(
      () => "---\nname: reports\ndescription: Personal reports\n---\nUse the personal template.",
    );
    const loadResource = vi.fn(() => "print('personal')");
    const shadowedContent = vi.fn(skill.loadContent);
    const shadowedResource = vi.fn(skill.loadResource);
    const provider = createSkillsProvider(
      [
        { ...skill, loadContent: shadowedContent, loadResource: shadowedResource },
        { ...skill, description: "Personal reports", loadContent, loadResource },
      ],
      meta,
    )!;
    const load = provider.tools.find((tool) => tool.name === "load_skill")!;

    expect(convertSchemaToJsonSchema(load.inputSchema)!).toMatchObject({ properties: { name: { enum: ["reports"] } } });
    expect(provider.instructions).toContain("Personal reports");
    expect(provider.instructions).not.toContain("Create reports");
    const output = await load.execute({ name: "reports" });
    expect(output).toEqual([{ type: "text", content: expect.stringContaining("Use the personal template.") }]);
    const files = await mountSkillFiles();
    expect(files["/skills/reports/scripts/check.py"]).toEqual({ content: "print('personal')" });
    expect(loadContent).toHaveBeenCalledOnce();
    expect(loadResource).toHaveBeenCalledExactlyOnceWith("scripts/check.py");
    expect(shadowedContent).not.toHaveBeenCalled();
    expect(shadowedResource).not.toHaveBeenCalled();
  });

  it("keeps the complete selected catalog available above the native default token cap", async () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({
      name: `reports-${String(index).padStart(2, "0")}`,
      description: "Create detailed reports and verify their contents. ".repeat(16),
      loadContent: vi.fn(() => `Instructions for report ${index}.`),
    }));
    const selected = entries.at(-1)!;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(finished(response([callItem(JSON.stringify({ name: selected.name }), "load_skill")])))
      .mockResolvedValueOnce(finished(response([textItem("Done")])));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: new URL("http://localhost") });
    const provider = createSkillsProvider(entries, meta)!;
    const result = await run(new Client(), "model", provider.chat!.instructions!, prompt, provider.chat!.tools, {
      middleware: provider.chat!.middleware,
    });

    expect(result.status).toBe("completed");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.instructions.length).toBeGreaterThan(4000 * 4);
    for (const entry of entries) {
      expect(request.instructions).toContain(`- **${entry.name}**: ${entry.description}`);
      expect(entry.loadContent).toHaveBeenCalledTimes(entry === selected ? 1 : 0);
    }
    expect(
      request.tools.find((tool: { name: string }) => tool.name === "load_skill").parameters.properties.name.enum,
    ).toEqual(entries.map((entry) => entry.name));
    const nextRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(nextRequest.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          output: expect.stringContaining("Instructions for report 39."),
        }),
      ]),
    );
  });

  it("reads a bundled resource through the gateway without a strict-mode fallback warning", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(finished(response([callItem('{"name":"reports"}', "load_skill", "load")])))
      .mockResolvedValueOnce(
        finished(
          response([callItem('{"skill":"reports","path":"scripts/check.py"}', "read_skill_resource", "resource")]),
        ),
      )
      .mockResolvedValueOnce(finished(response([textItem("The resource contains print('ok').")])));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: new URL("http://localhost") });
    const loadResource = vi.fn(skill.loadResource);
    const provider = createSkillsProvider([{ ...skill, loadResource }], meta)!;
    const result = await run(new Client(), "model", provider.chat!.instructions!, prompt, provider.chat!.tools, {
      middleware: provider.chat!.middleware,
    });

    expect(result.status).toBe("completed");
    expect(loadResource).toHaveBeenCalledExactlyOnceWith("scripts/check.py");
    const firstRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstRequest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "read_skill_resource",
          strict: false,
          parameters: expect.objectContaining({
            properties: { skill: { type: "string" }, path: { type: "string" } },
            required: ["skill", "path"],
          }),
        }),
      ]),
    );
    const finalRequest = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(finalRequest.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          call_id: "resource",
          output: JSON.stringify({
            skill: "reports",
            path: "scripts/check.py",
            content: "print('ok')",
            encoding: "utf8",
          }),
        }),
      ]),
    );
    expect(warning.mock.calls.flat().join("\n")).not.toContain("sent with strict: false");
  });

  it("lets middleware own discovery, loading, and deduplication in the real chat loop", async () => {
    const loadContent = vi.fn(skill.loadContent);
    const provider = createSkillsProvider([{ ...skill, loadContent }], meta)!;
    const complete = vi
      .fn()
      .mockResolvedValueOnce(call("load", "load_skill", { name: "reports" }))
      .mockResolvedValueOnce(call("again", "load_skill", { name: "reports" }))
      .mockResolvedValueOnce(call("resource", "read_skill_resource", { skill: "reports", path: "scripts/check.py" }))
      .mockResolvedValueOnce(done);
    const result = await run(
      testClient(complete),
      "model",
      provider.chat!.instructions!,
      prompt,
      provider.chat!.tools,
      {
        middleware: provider.chat!.middleware,
      },
    );
    expect(result.status).toBe("completed");
    expect(loadContent).toHaveBeenCalledOnce();
    const firstRequest = complete.mock.calls[0][0];
    expect(firstRequest.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "read_skill_resource",
      "load_skill",
    ]);
    expect(JSON.stringify(firstRequest.systemPrompts)).toContain("Create reports");
    expect(JSON.stringify(firstRequest.systemPrompts)).toContain("before proceeding");
    const results = result.messages
      .flatMap((message) => message.parts)
      .flatMap((part) =>
        part.type === "tool-result" && typeof part.content === "string" ? [JSON.parse(part.content)] : [],
      );
    expect(results).toEqual([
      {
        skill: "reports",
        content: "Verify the report.",
        resources: ["scripts/check.py"],
        scripts: [],
        compatibility: "Browser Python",
      },
      { skill: "reports", content: ALREADY_LOADED, resources: [], scripts: [] },
      { skill: "reports", path: "scripts/check.py", content: "print('ok')", encoding: "utf8" },
    ]);

    // Reuse the same provider/middleware in another chat: activation is scoped
    // to the native invocation, never a global provider cache.
    const next = vi
      .fn()
      .mockResolvedValueOnce(call("next", "load_skill", { name: "reports" }))
      .mockResolvedValueOnce(done);
    expect(
      (
        await run(testClient(next), "model", "", prompt, provider.chat!.tools, {
          middleware: provider.chat!.middleware,
        })
      ).status,
    ).toBe("completed");
    expect(loadContent).toHaveBeenCalledTimes(2);
  });

  it("scopes the realtime native tool activation set to each tools request", async () => {
    const provider = createSkillsProvider([skill], meta)!;
    const load = provider.tools.find((tool) => tool.name === "load_skill")!;
    const first = await load.execute({ name: "reports" });
    expect(first).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("Verify the report.") })]),
    );
    expect(await load.execute({ name: "reports" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining(ALREADY_LOADED) })]),
    );
    expect(await provider.tools[0].execute({ name: "reports" })).toEqual(first);
    expect(load.display?.output?.(first)).toMatchObject({ code: "Verify the report.", language: "markdown" });
  });

  it("reports native resource errors and renders native resource output", async () => {
    const provider = createSkillsProvider([skill], meta)!;
    const resource = provider.tools.find((tool) => tool.name === "read_skill_resource")!;
    await expect(resource.execute({ skill: "reports", path: "../secret" })).rejects.toThrow("unsafe resource path");
    await expect(resource.execute({ skill: "unknown", path: "scripts/check.py" })).rejects.toThrow("no skill named");
    const output = await resource.execute({ skill: "reports", path: "scripts/check.py" });
    expect(resource.display?.output?.(output)).toMatchObject({
      code: "print('ok')",
      language: "py",
      name: "scripts/check.py",
    });
  });
});

describe("selected skill resource mounts", () => {
  it("mounts resources from the provider-selected entries without model arguments", async () => {
    createSkillsProvider(
      [
        {
          name: "selected-pdf",
          description: "Selected PDF helper",
          resources: ["scripts/check.py"],
          loadContent: () => "instructions",
          loadResource: (path) => (path === "scripts/check.py" ? "print('ok')" : null),
        },
        {
          name: "selected-data",
          description: "Selected data helper",
          resources: ["assets/schema.json"],
          loadContent: () => "instructions",
          loadResource: (path) => (path === "assets/schema.json" ? '{"type":"object"}' : null),
        },
      ],
      { id: "test-skills", name: "Test skills", description: "Fixture" },
    );

    await expect(mountSkillFiles()).resolves.toEqual({
      "/skills/selected-pdf/scripts/check.py": { content: "print('ok')" },
      "/skills/selected-data/assets/schema.json": { content: '{"type":"object"}' },
    });
  });

  it("returns no mounts when the selected entries have no resources", async () => {
    createSkillsProvider([{ name: "prompt-only", description: "No resources", loadContent: () => "instructions" }], {
      id: "test-skills",
      name: "Test skills",
      description: "Fixture",
    });

    await expect(mountSkillFiles()).resolves.toEqual({});
  });

  it("isolates same-named plugin mounts and clears them when the selection becomes empty", async () => {
    createSkillsProvider(
      [undefined, "one", "two"].map((plugin) => ({
        ...skill,
        plugin,
        loadResource: () => plugin ?? "personal",
      })),
      meta,
    );
    await expect(mountSkillFiles()).resolves.toEqual({
      "/skills/reports/scripts/check.py": { content: "personal" },
      "/skills/one:reports/scripts/check.py": { content: "one" },
      "/skills/two:reports/scripts/check.py": { content: "two" },
    });
    expect(createSkillsProvider([], meta)).toBeNull();
    await expect(mountSkillFiles()).resolves.toEqual({});
  });
});
