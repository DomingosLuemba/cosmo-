import type { Sensitivity } from "../types/actions.js";

/**
 * Fonte da verdade em código para docs/POLICY.md — as duas devem ficar em
 * sincronia. Tools nesta lista SEMPRE exigem aprovação, independente dos
 * parâmetros.
 */
const ALWAYS_SENSITIVE_TOOLS = new Set([
  "subscribe_service",
  "make_purchase",
  "delete_data",
]);

/**
 * compose_message é sensível quando parece ser a primeira vez que se fala
 * com esse contato — nesse caso tratamos como zona cinzenta (ver
 * docs/POLICY.md) e exigimos aprovação. Sem um histórico de contatos aqui
 * no backend, o padrão seguro é: NUNCA autônomo para envio de mensagens.
 */
const CONDITIONALLY_SENSITIVE_TOOLS = new Set(["compose_message"]);

export interface SensitivityResult {
  sensitivity: Sensitivity;
  reason: string;
}

export function classifyAction(
  toolName: string,
  _input: Record<string, unknown>
): SensitivityResult {
  if (ALWAYS_SENSITIVE_TOOLS.has(toolName)) {
    return {
      sensitivity: "approval_required",
      reason: `"${toolName}" envolve dinheiro ou exclusão permanente — sempre exige aprovação.`,
    };
  }

  if (CONDITIONALLY_SENSITIVE_TOOLS.has(toolName)) {
    return {
      sensitivity: "approval_required",
      reason: `"${toolName}" é comunicação com terceiros — exige aprovação por padrão.`,
    };
  }

  return {
    sensitivity: "auto",
    reason: "Ação reversível e cotidiana — executada de forma autônoma.",
  };
}
