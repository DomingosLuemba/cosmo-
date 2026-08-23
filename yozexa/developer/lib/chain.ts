import { YozexaClient, type NodeStatus } from "@yozexa/sdk";

export const NODE_URL = process.env.YOZEXA_NODE ?? "http://127.0.0.1:1717";

export function chainClient(): YozexaClient {
  return new YozexaClient({ url: NODE_URL, timeoutMs: 15_000 });
}

/** Node status, or null when the node is unreachable. */
export async function chainStatus(): Promise<NodeStatus | null> {
  try {
    return await chainClient().status();
  } catch {
    return null;
  }
}
