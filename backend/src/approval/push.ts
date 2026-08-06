import type { PendingApproval } from "../types/actions.js";

/**
 * Stub de envio de push via APNs. Uma implementação real assinaria um JWT
 * com a chave APNs (APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY_PATH) e
 * enviaria via HTTP/2 para api.push.apple.com. Fora do escopo do esqueleto:
 * aqui só logamos, para deixar o ponto de extensão claro.
 */
export async function notifyApprovalPending(
  deviceToken: string,
  approval: PendingApproval
): Promise<void> {
  const configured = Boolean(process.env.APNS_KEY_ID);
  if (!configured) {
    console.log(
      `[push:stub] aprovação pendente ${approval.id} para device ${deviceToken} — ` +
        `configure APNS_* no .env para enviar push de verdade.`
    );
    return;
  }

  // TODO: implementar envio real via APNs (HTTP/2 + JWT provider token).
  console.log(`[push] enviando aprovação ${approval.id} para ${deviceToken}`);
}
