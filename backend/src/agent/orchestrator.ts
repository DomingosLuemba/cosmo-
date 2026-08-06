import Anthropic from "@anthropic-ai/sdk";
import { tools } from "./tools.js";
import { classifyAction } from "../policy/sensitivity.js";
import { deviceQueue } from "../store/deviceQueue.js";
import { approvalStore } from "../approval/approvalStore.js";
import { notifyApprovalPending } from "../approval/push.js";
import { sessionStore, type Session } from "../store/sessionStore.js";
import type { DeviceAction } from "../types/actions.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-5";

const SYSTEM_PROMPT = `Você é Cosmo, um assistente que controla o iPhone do usuário através de um \
catálogo fixo de ações (tools). Aja com autonomia total em tarefas cotidianas e reversíveis.

Pare e peça aprovação explícita apenas para: assinaturas, compras, pagamentos, exclusão \
permanente de dados, mudanças de segurança de conta, e envio de mensagens/e-mails a terceiros. \
Você não decide isso sozinho — cada tool já está marcada como autônoma ou sensível pelo sistema; \
você só precisa chamar a tool certa e explicar ao usuário, em texto, o que está fazendo.

Nunca invente uma ação que não exista no catálogo de tools. Se o pedido do usuário não \
corresponder a nenhuma tool disponível, explique a limitação em vez de fingir que executou algo.`;

export interface TurnOutcome {
  reply: string;
  queuedActions: DeviceAction[];
  pendingApprovals: string[];
}

export async function startTurn(
  userId: string,
  deviceId: string,
  deviceToken: string,
  userText: string
): Promise<TurnOutcome> {
  const session = sessionStore.getOrCreate(userId, deviceId, deviceToken);
  session.history.push({ role: "user", content: userText });
  return step(userId, deviceId, session);
}

/** Chamado quando uma ação (auto ou aprovada) termina de executar no aparelho. */
export async function recordToolResult(
  userId: string,
  deviceId: string,
  actionId: string,
  result: unknown,
  error?: string
): Promise<TurnOutcome | null> {
  const session = sessionStore.find(userId, deviceId);
  if (!session) return null;

  session.bufferedResults.set(actionId, {
    type: "tool_result",
    tool_use_id: actionId,
    content: error ? `Erro: ${error}` : JSON.stringify(result ?? {}),
    is_error: Boolean(error),
  });
  session.pendingToolUseIds.delete(actionId);

  if (session.pendingToolUseIds.size > 0) {
    // Ainda faltam outras tools da mesma rodada responderem.
    return null;
  }

  session.history.push({
    role: "user",
    content: [...session.bufferedResults.values()],
  });
  session.bufferedResults.clear();

  return step(userId, deviceId, session);
}

/** Chamado quando o usuário nega uma aprovação pendente. */
export async function recordApprovalDenied(
  userId: string,
  deviceId: string,
  actionId: string
): Promise<TurnOutcome | null> {
  return recordToolResult(userId, deviceId, actionId, null, "Usuário negou a aprovação.");
}

async function step(userId: string, deviceId: string, session: Session): Promise<TurnOutcome> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools,
    messages: session.history,
  });

  session.history.push({ role: "assistant", content: response.content });

  const textParts = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text);

  const toolUseBlocks = response.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  const queuedActions: DeviceAction[] = [];
  const pendingApprovals: string[] = [];

  for (const block of toolUseBlocks) {
    session.pendingToolUseIds.add(block.id);

    const input = (block.input ?? {}) as Record<string, unknown>;
    const { sensitivity, reason } = classifyAction(block.name, input);

    const action: DeviceAction = {
      id: block.id,
      userId,
      deviceId,
      toolName: block.name,
      input,
      sensitivity,
      status: "pending_approval",
      createdAt: new Date().toISOString(),
    };

    if (sensitivity === "auto") {
      deviceQueue.enqueue(action);
      queuedActions.push(action);
    } else {
      const approval = approvalStore.create(action, reason);
      pendingApprovals.push(approval.id);
      await notifyApprovalPending(session.deviceToken, approval);
    }
  }

  return {
    reply: textParts.join("\n").trim(),
    queuedActions,
    pendingApprovals,
  };
}
