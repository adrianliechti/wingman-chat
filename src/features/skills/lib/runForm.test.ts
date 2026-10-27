import { describe, expect, it } from "vitest";
import definition from "../../../../skills/studio/compare-documents/run-form.json";
import followUp from "../../../../skills/studio/meeting-follow-up/run-form.json";
import { defaultRunValues, parseRunForm, prepareSkillRun, skillRunForm, type SkillWorkflow } from "./runForm";

const workflow: SkillWorkflow = {
  name: "compare-documents",
  form: parseRunForm(JSON.stringify(definition)),
  personal: false,
};
const previous = new File(["Payment within 30 days."], "policy.txt", { type: "text/plain" });
const current = new File(["Payment within 15 days."], "policy.txt", { type: "text/plain" });
const values = defaultRunValues(workflow.form);

describe("skill run forms", () => {
  it("validates every shipped workflow against the versioned form schema", () => {
    const forms = import.meta.glob("../../../../skills/studio/*/run-form.json", { eager: true, import: "default" });
    expect(Object.keys(forms)).toHaveLength(6);
    for (const form of Object.values(forms)) expect(() => parseRunForm(JSON.stringify(form))).not.toThrow();
  });

  it("accepts pasted notes or an uploaded transcript, and rejects missing alternatives", () => {
    const meeting = { name: "meeting-follow-up", form: parseRunForm(JSON.stringify(followUp)), personal: false };
    const defaults = defaultRunValues(meeting.form);
    expect(() => prepareSkillRun(meeting, defaults, {})).toThrow("Provide at least one");
    expect(prepareSkillRun(meeting, { ...defaults, notes: "Agreed to run the pilot." }, {}).uploads).toHaveLength(0);
    expect(prepareSkillRun(meeting, defaults, { transcript: previous }).uploads).toHaveLength(1);
    expect(() => prepareSkillRun(meeting, { ...defaults, notes: "a".repeat(50001) }, {})).toThrow("too long");
    expect(() => parseRunForm(JSON.stringify({ ...followUp, atLeastOneOf: ["missing", "notes"] }))).toThrow(
      "existing fields",
    );
  });

  it("keeps both same-named versions intact and binds each role to its own upload", async () => {
    const run = prepareSkillRun(
      workflow,
      { ...values, focus: 'Fees and "deadlines"\nExceptions' },
      { previous, current },
    );
    expect(run.uploads.map((file) => file.name)).toEqual(["previous-policy.txt", "current-policy.txt"]);
    expect(await Promise.all(run.uploads.map((file) => file.text()))).toEqual([
      "Payment within 30 days.",
      "Payment within 15 days.",
    ]);
    expect(run.content).toContain("**Previous version**\n/previous-policy.txt");
    expect(run.content).toContain("**Current version**\n/current-policy.txt");
    expect(run.content).toContain('**Review focus**\nFees and "deadlines"\nExceptions');
    expect(run.content).toContain("**Output language**\nEnglish");
    expect(previous.name).toBe("policy.txt");
  });

  it("rejects incomplete, empty, unsupported and oversized inputs before a run can start", () => {
    expect(() => prepareSkillRun(workflow, values, { previous })).toThrow("Current version");
    expect(() => prepareSkillRun(workflow, values, { previous, current: new File([], "empty.txt") })).toThrow("empty");
    expect(() => prepareSkillRun(workflow, values, { previous, current: new File(["data"], "file.exe") })).toThrow(
      "accepts",
    );
    expect(() => prepareSkillRun(workflow, values, { previous, current }, 2)).toThrow("size limit");
    expect(() => prepareSkillRun(workflow, { ...values, output: "invented" }, { previous, current })).toThrow(
      "Choose an option",
    );
  });

  it("rejects malformed, ambiguous or unsupported form definitions", () => {
    expect(() => parseRunForm("not json")).toThrow();
    expect(() => parseRunForm(JSON.stringify({ ...definition, version: 2 }))).toThrow();
    expect(() =>
      parseRunForm(JSON.stringify({ ...definition, fields: [definition.fields[0], definition.fields[0]] })),
    ).toThrow("Duplicate field");
    expect(() =>
      parseRunForm(
        JSON.stringify({
          ...definition,
          fields: [{ id: "output", type: "select", label: "Output", options: ["Chat"], default: "Other" }],
        }),
      ),
    ).toThrow("Invalid default");
    expect(() => parseRunForm(JSON.stringify({ ...definition, script: "alert(1)" }))).toThrow();
  });

  it("reads optional forms from existing skill resources without changing ordinary skills", () => {
    const skill = { name: "compare-documents", description: "Compare", content: "Read both versions." };
    expect(skillRunForm(skill)).toBeNull();
    expect(
      skillRunForm({ ...skill, resources: [{ path: "run-form.json", content: JSON.stringify(definition) }] }),
    ).toEqual(workflow.form);
  });
});
