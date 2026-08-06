import type Anthropic from "@anthropic-ai/sdk";

export interface Session {
  history: Anthropic.MessageParam[];
  deviceToken: string;
  /** IDs de tool_use da última resposta do Claude que ainda não voltaram. */
  pendingToolUseIds: Set<string>;
  /** tool_result já prontos, aguardando os demais da mesma rodada. */
  bufferedResults: Map<string, Anthropic.ToolResultBlockParam>;
}

/** Estado de conversa por (userId, deviceId), em memória. */
class SessionStore {
  private sessions = new Map<string, Session>();

  private key(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  getOrCreate(userId: string, deviceId: string, deviceToken: string): Session {
    const key = this.key(userId, deviceId);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        history: [],
        deviceToken,
        pendingToolUseIds: new Set(),
        bufferedResults: new Map(),
      };
      this.sessions.set(key, session);
    } else {
      session.deviceToken = deviceToken;
    }
    return session;
  }

  find(userId: string, deviceId: string): Session | undefined {
    return this.sessions.get(this.key(userId, deviceId));
  }
}

export const sessionStore = new SessionStore();
