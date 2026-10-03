/** The gateway's reasoning item: visible text, its summary, the replayable ciphertext, and the producing deployment. */
export interface GatewayReasoning {
  id?: string;
  encryptedContent?: string;
  text?: string;
  summary?: string;
  model?: string;
}

/** Keep gateway fields in TanStack's opaque signature, which survives native model/UI conversion. */
export function packGatewayReasoning(state: GatewayReasoning): string {
  return JSON.stringify({
    id: state.id,
    encrypted_content: state.encryptedContent,
    wingman: { text: state.text, summary: state.summary, model: state.model },
  });
}

/** Also accepts signatures written by the unextended native Responses adapter. */
export function readGatewayReasoning(signature?: string): GatewayReasoning {
  if (!signature) return {};
  try {
    const value = JSON.parse(signature);
    if (!value || typeof value !== "object") return {};
    const fields = value.wingman;
    return {
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      ...(typeof value.encrypted_content === "string" ? { encryptedContent: value.encrypted_content } : {}),
      ...(typeof fields?.text === "string" ? { text: fields.text } : {}),
      ...(typeof fields?.summary === "string" ? { summary: fields.summary } : {}),
      ...(typeof fields?.model === "string" ? { model: fields.model } : {}),
    };
  } catch {
    return {};
  }
}
