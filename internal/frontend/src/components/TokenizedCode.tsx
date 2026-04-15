import type { ThemedToken } from "shiki";

interface TokenizedCodeProps {
  tokens?: ThemedToken[];
  fallback: string;
}

export function TokenizedCode({ tokens, fallback }: TokenizedCodeProps) {
  if (tokens && tokens.length > 0) {
    return tokens.map((token, i) => (
      <span key={i} style={{ color: token.color }}>
        {token.content}
      </span>
    ));
  }
  return <>{fallback}</>;
}
