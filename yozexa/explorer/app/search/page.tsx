export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  return (
    <>
      <h1>No match</h1>
      <p className="subtitle">
        Nothing on this chain matches <span className="mono">{q ?? ""}</span>.
      </p>
      <div className="card">
        <p style={{ marginTop: 0 }}>The explorer understands:</p>
        <ul className="dim" style={{ marginBottom: 0, lineHeight: 1.9 }}>
          <li>
            a <strong>block height</strong> — a plain number, e.g. <span className="mono">42</span>
          </li>
          <li>
            a <strong>transaction hash</strong> — 64 hex characters
          </li>
          <li>
            an <strong>address</strong> — starting <span className="mono">yzx1</span>
          </li>
          <li>
            a <strong>validator</strong> — starting <span className="mono">yzxvaloper1</span>
          </li>
          <li>
            a <strong>YOZEXA ID</strong> — e.g. <span className="mono">maria.yzx</span>
          </li>
        </ul>
      </div>
    </>
  );
}
