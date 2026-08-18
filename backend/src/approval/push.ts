import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect, type ClientHttp2Session } from "node:http2";
import type { PendingApproval } from "../types/actions.js";

/**
 * Envio de push via APNs (HTTP/2 + provider token JWT ES256).
 *
 * Precisa das variáveis `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` e
 * `APNS_PRIVATE_KEY_PATH` (a chave `.p8` baixada do portal da Apple). Sem
 * elas o módulo continua funcionando como stub: apenas loga a aprovação,
 * para o backend rodar em dev sem conta de desenvolvedor.
 */

const REQUIRED_ENV = [
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_BUNDLE_ID",
  "APNS_PRIVATE_KEY_PATH",
] as const;

const APNS_ORIGINS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;

/**
 * A Apple aceita um provider token por 1h e recusa a geração de tokens novos
 * com menos de 20min de intervalo; 45min fica confortavelmente entre os dois.
 */
const TOKEN_MAX_AGE_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Depois disso a aprovação provavelmente já foi resolvida no app. */
const PUSH_EXPIRATION_SECONDS = 60 * 60;

interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyPath: string;
  origin: string;
}

function readApnsConfig(): ApnsConfig | null {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    if (missing.length < REQUIRED_ENV.length) {
      warnOnce(
        `[push] configuração de APNs incompleta, faltando: ${missing.join(", ")}.`
      );
    }
    return null;
  }

  const env = process.env.APNS_ENV === "production" ? "production" : "sandbox";
  return {
    keyId: process.env.APNS_KEY_ID!,
    teamId: process.env.APNS_TEAM_ID!,
    bundleId: process.env.APNS_BUNDLE_ID!,
    privateKeyPath: process.env.APNS_PRIVATE_KEY_PATH!,
    // `APNS_HOST` existe para apontar a um mock local em testes.
    origin: process.env.APNS_HOST ?? APNS_ORIGINS[env],
  };
}

const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

// --- provider token (JWT ES256) ---------------------------------------------

let signingKey: { path: string; key: KeyObject } | undefined;
let cachedToken: { keyId: string; token: string; createdAt: number } | undefined;

async function loadSigningKey(path: string): Promise<KeyObject> {
  if (signingKey?.path === path) return signingKey.key;
  const pem = await readFile(path, "utf8");
  const key = createPrivateKey(pem);
  signingKey = { path, key };
  return key;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** Gera (ou reaproveita) o JWT que autentica o backend junto ao APNs. */
async function providerToken(config: ApnsConfig): Promise<string> {
  const fresh =
    cachedToken?.keyId === config.keyId &&
    Date.now() - cachedToken.createdAt < TOKEN_MAX_AGE_MS;
  if (cachedToken && fresh) return cachedToken.token;

  const key = await loadSigningKey(config.privateKeyPath);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(
    JSON.stringify({ iss: config.teamId, iat: Math.floor(Date.now() / 1000) })
  );
  const payload = `${header}.${claims}`;
  // O JOSE espera a assinatura ECDSA crua (R||S), não o DER padrão do Node.
  const signature = sign("sha256", Buffer.from(payload), {
    key,
    dsaEncoding: "ieee-p1363",
  });

  const token = `${payload}.${base64url(signature)}`;
  cachedToken = { keyId: config.keyId, token, createdAt: Date.now() };
  return token;
}

// --- conexão HTTP/2 ----------------------------------------------------------

let http2Session: ClientHttp2Session | undefined;
let inFlight = 0;

/**
 * A Apple recomenda manter a conexão HTTP/2 aberta entre envios. Ela fica
 * `unref`ada enquanto ociosa para não segurar o processo no ar.
 */
function getSession(origin: string): ClientHttp2Session {
  if (http2Session && !http2Session.closed && !http2Session.destroyed) {
    return http2Session;
  }

  const session = connect(origin);
  session.on("error", (err) => {
    console.error(`[push] conexão com ${origin} falhou: ${describe(err)}`);
  });
  session.on("close", () => {
    if (http2Session === session) http2Session = undefined;
  });
  session.unref();
  http2Session = session;
  return session;
}

interface ApnsResponse {
  status: number;
  /** Código de erro da Apple (`BadDeviceToken`, `Unregistered`, ...). */
  reason?: string;
  apnsId?: string;
}

function postNotification(
  session: ClientHttp2Session,
  headers: Record<string, string>,
  body: string
): Promise<ApnsResponse> {
  return new Promise((resolve, reject) => {
    const request = session.request(headers);
    request.setEncoding("utf8");
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`sem resposta do APNs em ${REQUEST_TIMEOUT_MS}ms`));
    });

    let status = 0;
    let apnsId: string | undefined;
    let raw = "";

    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 0);
      const id = responseHeaders["apns-id"];
      apnsId = typeof id === "string" ? id : undefined;
    });
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("error", reject);
    request.on("end", () => {
      let reason: string | undefined;
      if (raw) {
        try {
          reason = (JSON.parse(raw) as { reason?: string }).reason;
        } catch {
          reason = raw;
        }
      }
      resolve({ status, reason, apnsId });
    });

    request.end(body);
  });
}

// --- envio -------------------------------------------------------------------

function buildPayload(approval: PendingApproval): string {
  return JSON.stringify({
    aps: {
      alert: {
        title: "Aprovação necessária",
        body: approval.reason,
      },
      sound: "default",
      // Acorda o app em background para ele já buscar a aprovação
      // (ver `PushHandler.didReceiveRemoteNotification` no app iOS).
      "content-available": 1,
    },
    type: "approval_pending",
    approvalId: approval.id,
    deviceId: approval.deviceId,
    actionId: approval.action.id,
    toolName: approval.action.toolName,
  });
}

async function send(
  config: ApnsConfig,
  deviceToken: string,
  approval: PendingApproval,
  body: string
): Promise<ApnsResponse> {
  return postNotification(
    getSession(config.origin),
    {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${await providerToken(config)}`,
      "content-type": "application/json",
      "apns-topic": config.bundleId,
      // `alert` (e não `background`) porque a aprovação precisa ser vista;
      // o `content-available` no payload ainda acorda o app.
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(
        Math.floor(Date.now() / 1000) + PUSH_EXPIRATION_SECONDS
      ),
      // Reenvios da mesma aprovação substituem a notificação anterior.
      "apns-collapse-id": approval.id,
    },
    body
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hint(reason: string | undefined, config: ApnsConfig): string {
  switch (reason) {
    case "BadDeviceToken":
      return ` — o token não pertence a ${config.origin}; confira APNS_ENV (builds do Xcode usam sandbox).`;
    case "TopicDisallowed":
    case "DeviceTokenNotForTopic":
      return ` — APNS_BUNDLE_ID (${config.bundleId}) não bate com o app do token.`;
    case "Unregistered":
      return " — o app foi desinstalado; descarte esse device token.";
    case "InvalidProviderToken":
      return " — confira APNS_KEY_ID/APNS_TEAM_ID e a chave .p8 em APNS_PRIVATE_KEY_PATH.";
    default:
      return "";
  }
}

/**
 * Notifica o dispositivo de que há uma aprovação pendente.
 *
 * Nunca lança: uma falha de push não deve derrubar o turno do agente, já que
 * o app também descobre aprovações pendentes pelo polling normal.
 */
export async function notifyApprovalPending(
  deviceToken: string,
  approval: PendingApproval
): Promise<void> {
  const config = readApnsConfig();
  if (!config) {
    console.log(
      `[push:stub] aprovação pendente ${approval.id} para device ${deviceToken} — ` +
        `configure APNS_* no .env para enviar push de verdade.`
    );
    return;
  }

  const body = buildPayload(approval);
  try {
    let response = await send(config, deviceToken, approval, body);

    // Token de provider expirado: descarta o cache e tenta uma vez mais.
    if (response.status === 403 && response.reason === "ExpiredProviderToken") {
      cachedToken = undefined;
      response = await send(config, deviceToken, approval, body);
    }

    if (response.status === 200) {
      console.log(
        `[push] aprovação ${approval.id} enviada para ${deviceToken}` +
          (response.apnsId ? ` (apns-id ${response.apnsId})` : "")
      );
      return;
    }

    console.error(
      `[push] APNs recusou a aprovação ${approval.id}: HTTP ${response.status} ` +
        `${response.reason ?? "sem motivo"}${hint(response.reason, config)}`
    );
  } catch (error) {
    console.error(
      `[push] falha ao enviar aprovação ${approval.id}: ${describe(error)}`
    );
  }
}
