import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { type CategoryConfig, categorySlug, getConfig, type RiskConfig, riskSlug } from "@/shared/config";
import { isAbortError } from "@/shared/lib/errors";
import { minimalEffort } from "@/shared/lib/models";
import { isUserMessage } from "@/shared/lib/requestContext";
import type { Chat, Message, Model } from "@/shared/types/chat";
import type { ConsentResult, PendingConsent } from "@/shared/types/elicitation";
import { sanitizeForClassification } from "../lib/chatHistory";

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
      abortController,
    }: {
      id: string;
      runId: string;
      conversation: Message[];
      title?: string;
      hasMessage: boolean;
      currentModel: Model;
      abortController: AbortController;
    }) => {
      latestRunByChatRef.current.set(id, runId);
      // Kick off the combined title + classification call in parallel with the model turn so
      // the consent/risk overlay can appear as soon as the user hits send, without waiting for
      // the stream. When categories or risks are configured we run every turn for detection
      // (and refresh the title every turn for free). With neither configured we keep the
      // original initial + every-3-user-turns cadence.
      const categoryConfigs = config.chat?.categories ?? [];
      const riskConfigs = config.chat?.risks ?? [];
      const classificationCfg = config.chat?.classification;
      const defaultThreshold = classificationCfg?.threshold ?? 0.5;
      const hasCategories = categoryConfigs.length > 0;
      const hasRisks = riskConfigs.length > 0;
      const userTurnCount = conversation.filter(isUserMessage).length;
      const needsTitle = !title || userTurnCount % 3 === 1;
      if (hasMessage && (needsTitle || hasCategories || hasRisks)) {
        const classificationModel = classificationCfg?.model || config.chat?.summarizer || currentModel.id;
        const classificationEffort =
          classificationCfg?.effort ??
          minimalEffort(models.find((model) => model.id === classificationModel) ?? classificationModel);
        client
          .classifyChat(
            classificationModel,
            // Classification concerns user intent, not tool implementation or
            // output. Keep only recent prose and lightweight media placeholders.
            sanitizeForClassification(conversation),
            categoryConfigs.map((c) => ({ id: categorySlug(c.name), description: c.description })),
            riskConfigs.map((r) => ({ id: riskSlug(r.name), description: r.description })),
            { effort: classificationEffort, signal: abortController.signal },
          )
          .then(({ title, categories: detectedCategories, risks: detectedRisks }) => {
            if (abortController.signal.aborted || latestRunByChatRef.current.get(id) !== runId) return;
            if (title) {
              updateChat(id, () => ({ title }));
            }

            // Risks take precedence over category consent — they're more severe.
            let next: PendingConsent | null = null;
            if (detectedRisks.length > 0 && hasRisks) {
              const acknowledged = acknowledgedRisksRef.current.get(id) ?? new Set<string>();
              const matchedRisk = detectedRisks
                .map((match) => {
                  const cfg = riskConfigs.find((r) => riskSlug(r.name) === match.id);
                  return cfg ? { cfg, confidence: match.confidence } : null;
                })
                .filter((m): m is { cfg: RiskConfig; confidence: number } => m !== null)
                .filter(({ cfg, confidence }) => confidence >= (cfg.threshold ?? defaultThreshold))
                .filter(({ cfg }) => !acknowledged.has(riskSlug(cfg.name)))
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
                  resolve: () => {},
                };
              }
            }

            if (!next && detectedCategories.length > 0 && hasCategories) {
              const consented = consentedCategoriesRef.current.get(id) ?? new Set<string>();
              const toAsk = detectedCategories
                .map((match) => {
                  const cfg = categoryConfigs.find((c) => categorySlug(c.name) === match.id);
                  return cfg ? { cfg, confidence: match.confidence } : null;
                })
                .filter((m): m is { cfg: CategoryConfig; confidence: number } => m !== null)
                .filter(({ cfg, confidence }) => confidence >= (cfg.threshold ?? defaultThreshold))
                .find(({ cfg }) => !!cfg.consent && !consented.has(categorySlug(cfg.name)));

              if (toAsk) {
                const customText = typeof toAsk.cfg.consent === "string" ? toAsk.cfg.consent : null;
                next = {
                  kind: "category",
                  id: categorySlug(toAsk.cfg.name),
                  name: toAsk.cfg.name,
                  consent: {
                    message:
                      customText ?? `This conversation appears to be about "${toAsk.cfg.name}". Please acknowledge.`,
                  },
                  resolve: () => {},
                };
              }
            }

            if (next && chatIdRef.current === id) {
              if (pendingRef.current?.chatId !== id) {
                pendingRef.current = { chatId: id, consent: next };
                setPendingConsent(next);
              }
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
