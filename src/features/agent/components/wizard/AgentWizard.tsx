import { Fragment, useReducer, useMemo, useState, useCallback, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Bot, Zap, Wrench, Folder, ClipboardCheck } from "lucide-react";
import { getConfig } from "@/shared/config";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent, BridgeServer } from "@/features/agent/types/agent";

import { WizardStepIndicator, type StepDef } from "./WizardStepIndicator";
import { WizardNavFooter } from "./WizardNavFooter";
import { IdentityStep } from "./steps/IdentityStep";
import { SkillsStep } from "./steps/SkillsStep";
import { ToolsStep } from "./steps/ToolsStep";
import { KnowledgeStep } from "./steps/KnowledgeStep";
import { ReviewStep } from "./steps/ReviewStep";

// ── State ──

interface WizardState {
  currentStep: number;
  visitedSteps: Set<number>;
  showValidation: boolean;

  name: string;
  description: string;
  instructions: string;

  selectedSkills: string[];
  selectedTools: string[];
  servers: Omit<BridgeServer, "id">[];

  pendingFiles: File[];

  model: string;
  memory: boolean;
}

export type WizardAction =
  | { type: "SET_STEP"; step: number }
  | { type: "SHOW_VALIDATION" }
  | { type: "SET_NAME"; value: string }
  | { type: "SET_DESCRIPTION"; value: string }
  | { type: "SET_INSTRUCTIONS"; value: string }
  | { type: "TOGGLE_SKILL"; name: string }
  | { type: "TOGGLE_TOOL"; id: string }
  | { type: "ADD_SERVER"; server: Omit<BridgeServer, "id"> }
  | { type: "REMOVE_SERVER"; index: number }
  | { type: "ADD_FILES"; files: File[] }
  | { type: "REMOVE_FILE"; index: number }
  | { type: "SET_MODEL"; id: string }
  | { type: "SET_MEMORY"; enabled: boolean }
  | { type: "RESET" };

function initialState(): WizardState {
  return {
    currentStep: 0,
    visitedSteps: new Set([0]),
    showValidation: false,
    name: "",
    description: "",
    instructions: "",
    selectedSkills: [],
    selectedTools: [],
    servers: [],
    pendingFiles: [],
    model: "",
    memory: false,
  };
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP": {
      const visited = new Set(state.visitedSteps);
      visited.add(action.step);
      return { ...state, currentStep: action.step, visitedSteps: visited, showValidation: false };
    }
    case "SHOW_VALIDATION":
      return { ...state, showValidation: true };
    case "SET_NAME":
      return { ...state, name: action.value };
    case "SET_DESCRIPTION":
      return { ...state, description: action.value };
    case "SET_INSTRUCTIONS":
      return { ...state, instructions: action.value };
    case "TOGGLE_SKILL": {
      const skills = state.selectedSkills.includes(action.name)
        ? state.selectedSkills.filter((n) => n !== action.name)
        : [...state.selectedSkills, action.name];
      return { ...state, selectedSkills: skills };
    }
    case "TOGGLE_TOOL": {
      const tools = state.selectedTools.includes(action.id)
        ? state.selectedTools.filter((t) => t !== action.id)
        : [...state.selectedTools, action.id];
      return { ...state, selectedTools: tools };
    }
    case "ADD_SERVER":
      return { ...state, servers: [...state.servers, action.server] };
    case "REMOVE_SERVER":
      return { ...state, servers: state.servers.filter((_, i) => i !== action.index) };
    case "ADD_FILES":
      return { ...state, pendingFiles: [...state.pendingFiles, ...action.files] };
    case "REMOVE_FILE":
      return { ...state, pendingFiles: state.pendingFiles.filter((_, i) => i !== action.index) };
    case "SET_MODEL":
      return { ...state, model: action.id };
    case "SET_MEMORY":
      return { ...state, memory: action.enabled };
    case "RESET":
      return initialState();
    default:
      return state;
  }
}

// ── Steps config ──

function getSteps(): StepDef[] {
  const config = getConfig();
  const steps: StepDef[] = [
    { id: "identity", label: "Identity", icon: Bot },
    { id: "skills", label: "Skills", icon: Zap },
    { id: "tools", label: "Tools", icon: Wrench },
  ];
  if (config.repository) {
    steps.push({ id: "knowledge", label: "Knowledge", icon: Folder });
  }
  steps.push({ id: "review", label: "Review", icon: ClipboardCheck });
  return steps;
}

// ── Component ──

interface AgentWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (agent: Agent, pendingFiles: File[]) => void;
}

export function AgentWizard({ isOpen, onClose, onCreated }: AgentWizardProps) {
  const { createAgent, addServer } = useAgents();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [isCreating, setIsCreating] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const steps = useMemo(() => getSteps(), []);
  const isLastStep = state.currentStep === steps.length - 1;
  const currentStepId = steps[state.currentStep]?.id;

  // Identity step requires a name
  const canAdvanceFromIdentity = !!state.name.trim();

  const canNext =
    currentStepId === "identity" ? canAdvanceFromIdentity : true;

  const handleNext = useCallback(() => {
    if (currentStepId === "identity" && !canAdvanceFromIdentity) {
      dispatch({ type: "SHOW_VALIDATION" });
      return;
    }
    if (state.currentStep < steps.length - 1) {
      dispatch({ type: "SET_STEP", step: state.currentStep + 1 });
    }
  }, [currentStepId, canAdvanceFromIdentity, state.currentStep, steps.length]);

  const handleBack = useCallback(() => {
    if (state.currentStep > 0) {
      dispatch({ type: "SET_STEP", step: state.currentStep - 1 });
    }
  }, [state.currentStep]);

  const handleStepClick = useCallback((index: number) => {
    dispatch({ type: "SET_STEP", step: index });
  }, []);

  const handleCreate = useCallback(async () => {
    const s = stateRef.current;
    setIsCreating(true);
    try {
      const agent = await createAgent(s.name.trim(), {
        description: s.description.trim() || undefined,
        instructions: s.instructions.trim() || undefined,
        skills: s.selectedSkills,
        tools: s.selectedTools,
        model: s.model || undefined,
        memory: s.memory || undefined,
      });

      // Add MCP servers
      for (const server of s.servers) {
        addServer(agent.id, server);
      }

      onCreated(agent, s.pendingFiles);
      dispatch({ type: "RESET" });
      onClose();
    } catch (error) {
      console.error("Failed to create agent:", error);
    } finally {
      setIsCreating(false);
    }
  }, [createAgent, addServer, onCreated, onClose]);

  const handleClose = useCallback(() => {
    dispatch({ type: "RESET" });
    onClose();
  }, [onClose]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-80" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-xl transform overflow-hidden rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl transition-all border border-neutral-200/50 dark:border-neutral-700/50">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                  <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    Create Agent
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Step indicator */}
                <WizardStepIndicator
                  steps={steps}
                  currentStep={state.currentStep}
                  visitedSteps={state.visitedSteps}
                  onStepClick={handleStepClick}
                />

                {/* Step content */}
                <div className="px-5 py-4 min-h-[320px] max-h-[60vh] overflow-y-auto">
                  {currentStepId === "identity" && (
                    <IdentityStep
                      name={state.name}
                      description={state.description}
                      instructions={state.instructions}
                      showValidation={state.showValidation}
                      dispatch={dispatch}
                    />
                  )}
                  {currentStepId === "skills" && (
                    <SkillsStep selectedSkills={state.selectedSkills} dispatch={dispatch} />
                  )}
                  {currentStepId === "tools" && (
                    <ToolsStep
                      selectedTools={state.selectedTools}
                      servers={state.servers}
                      dispatch={dispatch}
                    />
                  )}
                  {currentStepId === "knowledge" && (
                    <KnowledgeStep pendingFiles={state.pendingFiles} dispatch={dispatch} />
                  )}
                  {currentStepId === "review" && (
                    <ReviewStep
                      name={state.name}
                      description={state.description}
                      instructions={state.instructions}
                      selectedSkills={state.selectedSkills}
                      selectedTools={state.selectedTools}
                      servers={state.servers}
                      pendingFiles={state.pendingFiles}
                      model={state.model}
                      memory={state.memory}
                      dispatch={dispatch}
                    />
                  )}
                </div>

                {/* Navigation */}
                <WizardNavFooter
                  currentStep={state.currentStep}
                  totalSteps={steps.length}
                  canNext={canNext}
                  isLastStep={isLastStep}
                  onBack={handleBack}
                  onNext={handleNext}
                  onCreate={handleCreate}
                  isCreating={isCreating}
                />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
