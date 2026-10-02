import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { categorySlug, getConfig, riskSlug } from "@/shared/config";
import { isAbortError } from "@/shared/lib/errors";
import { minimalEffort } from "@/shared/lib/models";
import { isUserMessage } from "@/shared/lib/requestContext";
import type { Chat, Message, Model } from "@/shared/types/chat";
import type { ConsentResult, PendingConsent } from "@/shared/types/elicitation";

interface Options {
  models: Model[];
  chatId: string | null;
  chatIdRef: RefObject<string | null>;
  updateChat: (id: string, update: (chat: Chat) => Partial<Chat>) => void;
}

export function useChatClassification({ models, chatId, chatIdRef, updateChat }: Options) {
  const config = getConfig();
  const client = config.client;
  const latestRunByChatRef = useRef(new Map<string, string>());
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  const pendingRef = useRef<{ chatId: string; consent: PendingConsent } | null>(null);
  // chatId -> set of category ids the user has accepted in this session. Intentionally not persisted.
  const consentedCategoriesRef = useRef<Map<string, Set<string>>>(new Map());
  // chatId -> set of risk ids already acknowledged in this session (avoid repeating the same warning on every turn).
  const acknowledgedRisksRef = useRef<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    if (pendingRef.current?.chatId !== chatId) {
      pendingRef.current = null;
      setPendingConsent(null);
    }
  }, [chatId]);
  const classify = useCallback(
    ({
      id,
      runId,
      conversation,
      title,
      hasMessage,
      currentModel,
      signal,
    }: {
      id: string;
      runId: string;
      conversation: Message[];
      title?: string;
      hasMessage: boolean;
      currentModel: Model;
      signal?: AbortSignal;
    }) => {
      latestRunByChatRef.current.set(id, runId);
      if (!hasMessage) return;
      const isCurrentRun = () => !signal?.aborted && latestRunByChatRef.current.get(id) === runId;
      // System One only returns typed answers, so the title stays a small LLM call
      // on the initial turn and every third user turn.
      const userTurnCount = conversation.filter(isUserMessage).length;
      if (!title || userTurnCount % 3 === 1) {
        const titleModel = config.chat?.summarizer || currentModel.id;
        client
          .generateTitle(titleModel, conversation, {
            effort: minimalEffort(models.find((model) => model.id === titleModel) ?? titleModel),
            signal,
          })
          .then((title) => {
            if (title && isCurrentRun()) updateChat(id, () => ({ title }));
          })
          .catch((err) => {
            if (!isAbortError(err)) console.error("generateTitle failed", err);
          });
      }

      // Categories and risks are scored by System One on every prompt, in parallel
      // with the model turn, so the consent/risk overlay appears as soon as the
      // user hits send.
      const categoryConfigs = config.chat?.categories ?? [];
      const riskConfigs = config.chat?.risks ?? [];
      const classificationCfg = config.chat?.classification;
      const defaultThreshold = classificationCfg?.threshold ?? 0.5;
      if (categoryConfigs.length || riskConfigs.length) {
        // The gateway adapts completion models when no native System One model is configured.
        const classificationModel = classificationCfg?.model || config.chat?.summarizer || currentModel.id;
        client
          .classifyChat(
            classificationModel,
            conversation,
            categoryConfigs.map((c) => ({ id: categorySlug(c.name), description: c.description })),
            riskConfigs.map((r) => ({ id: riskSlug(r.name), name: r.name, description: r.description })),
            { effort: classificationCfg?.effort, signal },
          )
          .then(({ categories: detectedCategories, risks: detectedRisks }) => {
            if (!isCurrentRun()) return;

            // Risks take precedence over category consent — they're more severe.
            let next: PendingConsent | null = null;
            if (detectedRisks.length > 0) {
              const acknowledged = acknowledgedRisksRef.current.get(id) ?? new Set<string>();
              const matchedRisk = detectedRisks
                .flatMap((match) => {
                  const cfg = riskConfigs.find((r) => riskSlug(r.name) === match.id);
                  return cfg &&
                    match.confidence >= (cfg.threshold ?? defaultThreshold) &&
                    !acknowledged.has(riskSlug(cfg.name))
                    ? [{ cfg, confidence: match.confidence }]
                    : [];
                })
                // Show the highest-confidence unacknowledged risk first.
                .sort((a, b) => b.confidence - a.confidence)[0];

              if (matchedRisk) {
                const { cfg } = matchedRisk;
                next = {
                  kind: "risk",
                  id: riskSlug(cfg.name),
                  name: cfg.name,
                  consent: {
                    message:
                      cfg.message ??
                      `This request appears to involve "${cfg.name}", which may require special attention. Please review before continuing.`,
                    severity: cfg.severity ?? "medium",
                  },
                };
              }
            }

            const category = detectedCategories[0];
            if (!next && category) {
              const consented = consentedCategoriesRef.current.get(id) ?? new Set<string>();
              const toAsk = categoryConfigs.find(
                (cfg) =>
                  categorySlug(cfg.name) === category.id &&
                  category.confidence >= (cfg.threshold ?? defaultThreshold) &&
                  cfg.consent &&
                  !consented.has(category.id),
              );

              if (toAsk) {
                const customText = typeof toAsk.consent === "string" ? toAsk.consent : null;
                next = {
                  kind: "category",
                  id: category.id,
                  name: toAsk.name,
                  consent: {
                    message: customText ?? `This conversation appears to be about "${toAsk.name}". Please acknowledge.`,
                  },
                };
              }
            }

            if (chatIdRef.current === id) {
              pendingRef.current = next ? { chatId: id, consent: next } : null;
              setPendingConsent(next);
            }
          })
          .catch((err) => {
            if (!isAbortError(err)) console.error("classifyChat failed", err);
          });
      }
    },
    [client, config, models, chatIdRef, updateChat],
  );
  const resolveConsent = useCallback(
    (result: ConsentResult) => {
      const pending = pendingRef.current;
      if (!pending) return;
      if (result.action === "accept" && chatIdRef.current === pending.chatId) {
        const ref = pending.consent.kind === "risk" ? acknowledgedRisksRef : consentedCategoriesRef;
        const set = ref.current.get(pending.chatId) ?? new Set<string>();
        set.add(pending.consent.id);
        ref.current.set(pending.chatId, set);
      }
      pendingRef.current = null;
      setPendingConsent(null);
    },
    [chatIdRef],
  );

  return { classify, pendingConsent, resolveConsent };
}
