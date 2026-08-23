/** A payment's state, coloured by whether the merchant can act on it. */
export function StatusPill({ status }: { status: string }) {
  const kind =
    status === "confirmed" || status === "finalized"
      ? "ok"
      : status === "pending" || status === "created"
        ? "warn"
        : status === "failed" || status === "expired"
          ? "danger"
          : "dim";
  return <span className={`pill ${kind}`}>{status}</span>;
}
