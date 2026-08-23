/** A code block. Kept deliberately plain: no client-side highlighter, no runtime cost. */
export function Code({ children, language }: { children: string; language?: string }) {
  return (
    <div style={{ position: "relative", marginBottom: 20 }}>
      {language ? (
        <span
          className="dim mono"
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {language}
        </span>
      ) : null}
      <pre
        className="mono"
        style={{
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "16px 18px",
          overflowX: "auto",
          fontSize: 13,
          lineHeight: 1.65,
          margin: 0,
        }}
      >
        {children}
      </pre>
    </div>
  );
}
