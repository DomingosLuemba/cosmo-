/**
 * YOZEXA transaction messages.
 *
 * These mirror `chain/tx` exactly. The `type` strings are part of the signed
 * payload and are therefore consensus-critical: they may be added to, never
 * renamed.
 */

export const MsgType = {
  Send: "bank/send",
  MultiSend: "bank/multisend",
  Burn: "bank/burn",
  CreateValidator: "staking/create_validator",
  EditValidator: "staking/edit_validator",
  Delegate: "staking/delegate",
  Undelegate: "staking/undelegate",
  Redelegate: "staking/redelegate",
  WithdrawRewards: "staking/withdraw_rewards",
  Unjail: "staking/unjail",
  SubmitProposal: "gov/submit_proposal",
  Vote: "gov/vote",
  Deposit: "gov/deposit",
  ClaimVested: "vesting/claim",
  Grant: "auth/grant",
  Revoke: "auth/revoke",
  Exec: "auth/exec",
  RegisterAlias: "id/register_alias",
  TransferAlias: "id/transfer_alias",
} as const;

export type MsgTypeValue = (typeof MsgType)[keyof typeof MsgType];

/** A message in its wire envelope. */
export interface Msg {
  type: MsgTypeValue;
  value: Record<string, unknown>;
}

/** Send YZXA to another account. */
export function send(from: string, to: string, amount: bigint): Msg {
  if (from === to) throw new Error("sender and recipient are the same account");
  if (amount <= 0n) throw new Error("amount must be positive");
  return { type: MsgType.Send, value: { from, to, amount: amount.toString() } };
}

/** Pay many recipients atomically: either every leg lands or none does. */
export function multiSend(from: string, outputs: Array<{ to: string; amount: bigint }>): Msg {
  if (outputs.length === 0) throw new Error("multisend needs at least one output");
  if (outputs.length > 1000) throw new Error("multisend supports at most 1000 outputs");
  const seen = new Set<string>();
  for (const o of outputs) {
    if (o.amount <= 0n) throw new Error(`output to ${o.to} has a non-positive amount`);
    if (seen.has(o.to)) throw new Error(`duplicate recipient ${o.to}`);
    seen.add(o.to);
  }
  return {
    type: MsgType.MultiSend,
    value: {
      from,
      outputs: outputs.map((o) => ({ to: o.to, amount: o.amount.toString() })),
    },
  };
}

/** Permanently destroy YZXA. This cannot be undone by anyone. */
export function burn(from: string, amount: bigint): Msg {
  if (amount <= 0n) throw new Error("amount must be positive");
  return { type: MsgType.Burn, value: { from, amount: amount.toString() } };
}

/** Bond YZXA to a validator. */
export function delegate(delegator: string, validator: string, amount: bigint): Msg {
  if (amount <= 0n) throw new Error("amount must be positive");
  return {
    type: MsgType.Delegate,
    value: { delegator, validator, amount: amount.toString() },
  };
}

/** Begin unbonding. The stake stays slashable for the whole unbonding period. */
export function undelegate(delegator: string, validator: string, amount: bigint): Msg {
  if (amount <= 0n) throw new Error("amount must be positive");
  return {
    type: MsgType.Undelegate,
    value: { delegator, validator, amount: amount.toString() },
  };
}

/** Claim accrued staking rewards. */
export function withdrawRewards(delegator: string, validator: string): Msg {
  return { type: MsgType.WithdrawRewards, value: { delegator, validator } };
}

/** Vote on a governance proposal with the account's bonded stake. */
export function vote(
  voter: string,
  proposalId: number,
  option: "yes" | "no" | "abstain" | "no_with_veto",
): Msg {
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0) {
    throw new Error("proposal id must be a positive integer");
  }
  return { type: MsgType.Vote, value: { voter, proposal_id: proposalId, option } };
}

/** Register a YOZEXA ID. */
export function registerAlias(owner: string, alias: string): Msg {
  return { type: MsgType.RegisterAlias, value: { owner, alias } };
}

/** The limits a delegated spending permission carries. */
export interface SpendLimit {
  /** Lifetime maximum. Mandatory — there is no unlimited grant. */
  total: bigint;
  /** Maximum inside one rolling window. Omit with periodSeconds 0. */
  perPeriod?: bigint;
  /** Length of the rolling window in seconds. 0 disables the per-period cap. */
  periodSeconds?: number;
}

/** Everything a grant may restrict. */
export interface GrantOptions {
  /** Message types the grantee may execute. Governance can never be delegated. */
  allowedMsgTypes?: MsgTypeValue[];
  /** When set, the grantee may only pay these addresses. */
  allowedRecipients?: string[];
  /** Single payments above this amount require the account holder to sign. */
  requireApprovalAbove?: bigint;
}

/**
 * Create a delegated spending permission — the primitive behind subscriptions,
 * device session keys and AI agent wallets.
 *
 * The chain enforces every limit. A grantee cannot exceed the total, the rate,
 * the recipient list or the expiry, whatever software it runs, and the account
 * holder can revoke it in one transaction.
 */
export function grant(
  granter: string,
  grantee: string,
  limit: SpendLimit,
  expiresAt: Date,
  options: GrantOptions = {},
): Msg {
  if (limit.total <= 0n) {
    throw new Error("a grant must state a positive total limit; unlimited grants do not exist");
  }
  const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
  if (expiresAtUnix <= Math.floor(Date.now() / 1000)) {
    throw new Error("the grant expiry must be in the future");
  }
  const MAX_SECONDS = 365 * 24 * 60 * 60;
  if (expiresAtUnix - Math.floor(Date.now() / 1000) > MAX_SECONDS) {
    throw new Error("a grant may not run for longer than one year");
  }
  const periodSeconds = limit.periodSeconds ?? 0;
  if (periodSeconds > 0 && (limit.perPeriod ?? 0n) <= 0n) {
    throw new Error("a period was set but no per-period limit");
  }
  return {
    type: MsgType.Grant,
    value: {
      granter,
      grantee,
      allowed_msg_types: options.allowedMsgTypes ?? [MsgType.Send],
      ...(options.allowedRecipients?.length
        ? { allowed_recipients: options.allowedRecipients }
        : {}),
      limit: {
        total: limit.total.toString(),
        per_period: (limit.perPeriod ?? 0n).toString(),
        period_seconds: periodSeconds,
      },
      expires_at_unix: expiresAtUnix,
      require_approval_above: (options.requireApprovalAbove ?? 0n).toString(),
    },
  };
}

/** Revoke a spending permission immediately. */
export function revoke(granter: string, grantee: string): Msg {
  return { type: MsgType.Revoke, value: { granter, grantee } };
}

/** Execute messages on behalf of a granter, within their grant. */
export function exec(grantee: string, granter: string, msgs: Msg[]): Msg {
  if (msgs.length === 0) throw new Error("exec needs at least one message");
  if (msgs.length > 32) throw new Error("exec supports at most 32 messages");
  for (const m of msgs) {
    if (m.type === MsgType.Exec) throw new Error("nested exec is not allowed");
  }
  return { type: MsgType.Exec, value: { grantee, granter, msgs } };
}
