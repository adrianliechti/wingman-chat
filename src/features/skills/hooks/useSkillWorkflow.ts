import { useMatch, useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { useComposerDraftStore } from "@/features/chat/context/ComposerDraftProvider";
import { composerDraftKey, type ComposerDraft } from "@/features/chat/lib/composerDrafts";
import { formatArtifactReference } from "@/features/chat/components/chatMessageUtils";
import { processUploadedFile, type ProcessedFile } from "@/features/artifacts/lib/artifacts";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useProjects } from "@/features/projects/context/ProjectsContext";
import { getConfig } from "@/shared/config";
import { skillRefPart, text, userMessage } from "@/shared/lib/messages";
import { notify } from "@/shared/lib/notify";
import { useSkills } from "./useSkills";
import { useSkillTemplates } from "./useSkillTemplates";
import { loadSkillResource, type SkillTemplate } from "../lib/templates";
import type { Skill } from "../lib/skillParser";
import {
  parseRunForm,
  prepareSkillRun,
  RUN_FORM_PATH,
  skillRunForm,
  type RunFiles,
  type RunValues,
  type SkillWorkflow,
} from "../lib/runForm";

interface PendingRun {
  chatId: string;
  workflow: SkillWorkflow;
  draft: ComposerDraft;
  artifacts: ProcessedFile[];
}

export function useSkillWorkflow() {
  const { createChat, updateChat, chatId, chatLoading, chatError, model, sendMessage } = useChat();
  const { currentAgent } = useAgents();
  const { isLoaded: projectsLoaded, selectedProjectId, projects } = useProjects();
  const { isAvailable: artifactsAvailable } = useArtifacts();
  const drafts = useComposerDraftStore();
  const navigate = useNavigate();
  const route = useMatch({ from: "/app/chat/$chatId", shouldThrow: false });
  const { getSkill, closeSkillCatalog } = useSkills();
  const { templates } = useSkillTemplates();
  const [workflow, setWorkflow] = useState<SkillWorkflow | null>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRun | null>(null);
  const claimed = useRef<string | null>(null);
  const allowsTools = ["skills", "artifacts"].every((id) =>
    model?.tools?.enabled?.length ? model.tools.enabled.includes(id) : !model?.tools?.disabled?.includes(id),
  );
  const canRun = artifactsAvailable && projectsLoaded && !!model && model.id !== "realtime" && allowsTools;
  const starters = templates.filter((entry) => entry.category === "studio" && entry.resources?.includes(RUN_FORM_PATH));

  const openSkill = (skill: Skill) => {
    try {
      const form = skillRunForm(skill);
      if (!form) {
        notify.error("Cannot open workflow", "This skill does not have a run form.");
        return;
      }
      setWorkflow({ name: skill.name, form, personal: true });
      closeSkillCatalog();
    } catch {
      notify.error("Cannot open workflow", "The skill's run form is invalid. Check its run-form.json resource.");
    }
  };

  const openTemplate = async (template: SkillTemplate) => {
    if (loadingName) return;
    // Match the existing skills provider's personal-over-built-in precedence.
    const personal = getSkill(template.name);
    if (personal) {
      openSkill(personal);
      return;
    }
    setLoadingName(template.name);
    try {
      const content = await loadSkillResource(template.path, RUN_FORM_PATH);
      if (!content) throw new Error("The workflow could not be loaded. Try again.");
      setWorkflow({ name: template.name, form: parseRunForm(content), personal: false });
    } catch (error) {
      notify.error("Cannot open workflow", error);
    } finally {
      setLoadingName(null);
    }
  };

  const run = async (values: RunValues, files: RunFiles) => {
    if (!workflow || !canRun || !model) throw new Error("Select a chat model with file tools before starting.");
    const prepared = prepareSkillRun(workflow, values, files, getConfig().artifacts?.maxFileSize);
    const artifacts = (await Promise.all(prepared.uploads.map(processUploadedFile))).flat();
    const draft: ComposerDraft = {
      content: prepared.content,
      skills: workflow.personal ? [workflow.name] : [],
      pendingFiles: prepared.uploads,
      attachments: [],
      pendingImages: [],
    };
    const created = await createChat();
    updateChat(created.id, () => ({ model, title: workflow.form.title }));
    // Save a recoverable draft in the new chat without touching the old composer.
    const key = composerDraftKey(created.id);
    await drafts.load(key);
    drafts.update(key, () => draft);
    await navigate({ to: "/chat/$chatId", params: { chatId: created.id } });
    setPending({ chatId: created.id, workflow, draft, artifacts });
    setWorkflow(null);
  };

  const start = useEffectEvent((request: PendingRun) => {
    const key = composerDraftKey(request.chatId);
    drafts.setSending(key, true);
    const parts = [text(request.draft.content), skillRefPart(request.workflow.name)];
    if (request.artifacts.length) parts.push(text(formatArtifactReference(request.artifacts.map((file) => file.path))));
    void sendMessage(userMessage(parts), undefined, request.artifacts, undefined, () => {
      drafts.finishSending(request.draft);
      drafts.clearIfUnchanged(key, request.draft);
    }).catch((error) => {
      drafts.finishSending(request.draft);
      notify.error("Workflow could not start", error);
    });
  });

  // A fresh chat needs its own hydrated runner. Never send through the previous
  // conversation's closure, and claim once even under Strict Mode effect replay.
  useEffect(() => {
    if (!pending || claimed.current === pending.chatId) return;
    if (route?.params.chatId !== pending.chatId || chatError) {
      setPending(null);
      return;
    }
    if (chatId !== pending.chatId || chatLoading) return;
    claimed.current = pending.chatId;
    setPending(null);
    start(pending);
  }, [pending, route?.params.chatId, chatId, chatLoading, chatError]);

  const projectName = projects.find((project) => project.id === selectedProjectId)?.name;
  return {
    workflow,
    starters,
    loadingName,
    canRun,
    openSkill,
    openTemplate,
    run,
    close: () => setWorkflow(null),
    contextLabel: [currentAgent?.name ?? model?.name ?? "Selected model", projectName].filter(Boolean).join(" · "),
  };
}
