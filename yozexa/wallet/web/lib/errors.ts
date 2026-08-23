/**
 * Turning failures into sentences a person can act on.
 *
 * A wallet must never show `RPC ERROR 0x23994`. The user's question is always
 * one of three: is my money safe, what went wrong, and what do I do now. Every
 * message here answers all three, and the technical text is kept for the
 * developer view rather than thrown away.
 */

export interface HumanError {
  /** One sentence, plain language. */
  message: string;
  /** What the user can do, if anything. */
  action?: string;
  /** Reassurance where it is true — and only where it is true. */
  fundsSafe: boolean;
  /** The original text, shown only under Developer Details. */
  technical: string;
}

export function humanize(error: unknown): HumanError {
  const technical = error instanceof Error ? error.message : String(error);
  const lower = technical.toLowerCase();

  const match = (...needles: string[]): boolean => needles.some((n) => lower.includes(n));

  if (match("cannot reach", "failed to fetch", "networkerror", "econnrefused", "timed out", "abort")) {
    return {
      message: "We couldn't reach the YOZEXA network.",
      action: "Your funds are safe on the chain. Check your connection and try again.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("insufficient spendable", "insufficient balance", "cannot pay fee")) {
    return {
      message: "This account doesn't have enough spendable YZXA for this payment and its network fee.",
      action: "Try a smaller amount, or top up the account.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("still locked by vesting", "locked")) {
    return {
      message: "Part of this balance is still locked by a vesting schedule and cannot be moved yet.",
      action: "Only the vested portion can be spent. Your account shows when the next amount unlocks.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("sequence")) {
    return {
      message: "This payment was already sent, or another one is still in flight.",
      action: "Check your activity before trying again — you may have paid already.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("signature")) {
    return {
      message: "This transaction could not be authorised.",
      action: "Unlock the wallet and try again. Nothing was sent.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("chain id")) {
    return {
      message: "This transaction was prepared for a different YOZEXA network.",
      action: "Check which network the wallet is connected to. Nothing was sent.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("gas price", "base fee")) {
    return {
      message: "The network is busy and the fee you chose is below the current minimum.",
      action: "Choose a higher fee tier and try again.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("neither a valid", "not registered", "invalid bech32", "address")) {
    return {
      message: "That recipient isn't a valid YOZEXA address or a registered YOZEXA ID.",
      action: "Check it character by character, or scan a QR code instead.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("passphrase", "could not unlock")) {
    return {
      message: "That passphrase doesn't unlock this wallet.",
      action: "Try again. If you've lost it, restore the wallet from its 24-word recovery phrase.",
      fundsSafe: true,
      technical,
    };
  }

  if (match("grant", "permission", "limit exceeded")) {
    return {
      message: "This payment is outside the spending permission that authorised it.",
      action: "The account holder can approve it directly, or raise the permission's limit.",
      fundsSafe: true,
      technical,
    };
  }

  return {
    message: "Something went wrong and this action didn't complete.",
    action: "Your funds are safe. Try again, and check your activity to confirm nothing was sent twice.",
    fundsSafe: true,
    technical,
  };
}
