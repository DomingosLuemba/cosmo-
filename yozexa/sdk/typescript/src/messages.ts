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

/** A validator's public description. Only the moniker is required. */
export interface ValidatorDescription {
  moniker: string;
  identity?: string;
  website?: string;
  details?: string;
}

/**
 * Create a validator.
 *
 * Without this the validator set can never change after genesis, which makes a
 * network nobody can join. The consensus public key is CometBFT's base64
 * ed25519 form — `yozexad init` prints it.
 *
 * Commission is in basis points: 1000 is 10%. `maxCommissionBps` is a ceiling
 * the validator can never raise later, so delegators can rely on it.
 */
export function createValidator(
  operator: string,
  consensusPubKey: string,
  description: ValidatorDescription,
  options: {
    selfDelegation: bigint;
    commissionRateBps: number;
    maxCommissionBps: number;
    minSelfDelegation: bigint;
  },
): Msg {
  if (!consensusPubKey.trim()) {
    throw new Error("a consensus public key is required; `yozexad init` prints it");
  }
  if (!description.moniker.trim()) {
    throw new Error("a validator needs a moniker");
  }
  if (options.selfDelegation <= 0n) {
    throw new Error("a validator must bond a positive self-delegation");
  }
  if (options.minSelfDelegation <= 0n) {
    throw new Error("min_self_delegation must be positive");
  }
  if (options.selfDelegation < options.minSelfDelegation) {
    throw new Error("the self-delegation is below the minimum this validator commits to keeping");
  }
  if (options.commissionRateBps > options.maxCommissionBps) {
    throw new Error("commission cannot start above its own maximum");
  }
  if (options.maxCommissionBps > 10_000) {
    throw new Error("commission cannot exceed 100%");
  }
  return {
    type: MsgType.CreateValidator,
    value: {
      operator,
      consensus_pubkey: consensusPubKey,
      description: descriptionValue(description),
      commission_rate_bps: options.commissionRateBps,
      max_commission_bps: options.maxCommissionBps,
      min_self_delegation: options.minSelfDelegation.toString(),
      self_delegation: options.selfDelegation.toString(),
    },
  };
}

/**
 * Edit a validator's description, and optionally lower its commission.
 *
 * Commission can never exceed the maximum set at creation. Omit
 * `commissionRateBps` to leave the rate untouched.
 */
export function editValidator(
  operator: string,
  description: ValidatorDescription,
  commissionRateBps?: number,
): Msg {
  if (!description.moniker.trim()) {
    throw new Error("a validator needs a moniker");
  }
  return {
    type: MsgType.EditValidator,
    value: {
      operator,
      description: descriptionValue(description),
      ...(commissionRateBps === undefined ? {} : { commission_rate_bps: commissionRateBps }),
    },
  };
}

/**
 * Release a validator jailed for downtime.
 *
 * Jailing for missed blocks is recoverable: fix whatever took the node down,
 * wait out the jail period, and send this. Tombstoning is not — a validator
 * removed for double signing is refused here, permanently, and no governance
 * vote in this protocol can undo it.
 */
export function unjail(operator: string): Msg {
  return { type: MsgType.Unjail, value: { operator } };
}

/** Drop empty optional fields so the signed bytes stay canonical. */
function descriptionValue(d: ValidatorDescription): Record<string, string> {
  const out: Record<string, string> = { moniker: d.moniker };
  if (d.identity?.trim()) out.identity = d.identity;
  if (d.website?.trim()) out.website = d.website;
  if (d.details?.trim()) out.details = d.details;
  return out;
}
