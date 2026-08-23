/** Configuration for the YOZEXA Pay service. */

export interface Config {
  /** PostgreSQL connection string. */
  databaseUrl: string;
  /** YOZEXA node API. */
  nodeUrl: string;
  /** Listen address. */
  host: string;
  port: number;
  /**
   * The environment this instance serves: "test" or "live".
   *
   * An API key's own environment must match. This is what stops a test key
   * from moving real money and a live key from being used against a test
   * network — the two mistakes that cost the most.
   */
  environment: "test" | "live";
  /** How long a fiat quote stays valid. */
  quoteTtlSeconds: number;
  /** Where price data comes from, for the record kept against each payment. */
  priceSource: string;
  /** Maximum request body, in bytes. */
  maxBodyBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const environment = env.YOZEXA_ENVIRONMENT ?? "test";
  if (environment !== "test" && environment !== "live") {
    throw new Error(`YOZEXA_ENVIRONMENT must be "test" or "live", got ${JSON.stringify(environment)}`);
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  return {
    databaseUrl,
    nodeUrl: env.YOZEXA_NODE ?? "http://127.0.0.1:1717",
    host: env.PAY_HOST ?? "127.0.0.1",
    port: Number(env.PAY_PORT ?? 8080),
    environment,
    quoteTtlSeconds: Number(env.QUOTE_TTL_SECONDS ?? 60),
    priceSource: env.PRICE_SOURCE ?? "none",
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? 256 * 1024),
  };
}
