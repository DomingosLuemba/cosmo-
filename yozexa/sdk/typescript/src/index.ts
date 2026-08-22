/**
 * `@yozexa/sdk` — the TypeScript client for the YOZEXA Network.
 *
 * Three things it will not do, on purpose:
 *
 *   - use `number` for a monetary value (every amount is a `bigint` in base
 *     units, because a JavaScript number cannot represent 10^18 exactly);
 *   - treat mempool acceptance as settlement (`pending` and `confirmed` are
 *     distinct, and `waitForSettlement` will not resolve on `pending`);
 *   - build a spending permission without a total and an expiry (unlimited
 *     grants cannot be expressed on this network).
 */

export * from "./units.js";
export * from "./address.js";
export * from "./canonical.js";
export * from "./keys.js";
export * from "./messages.js";
export * from "./transaction.js";
export * from "./client.js";

export * as messages from "./messages.js";
