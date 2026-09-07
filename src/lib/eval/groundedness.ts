const STOP = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "were",
  "they",
  "them",
  "then",
  "than",
  "also",
  "into",
  "only",
  "does",
  "using",
  "used",
  "about",
  "after",
  "before",
  "their",
  "there",
  "which",
  "while",
  "where",
  "when",
  "what",
  "your",
  "file",
  "files",
  "source",
  "sources",
  "context",
]);

export function splitClaims(answer: string): string[] {
  const body = answer.replace(/\n+Sources:[\s\S]*$/i, "").trim();
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/^[-*]\s+/, "").trim())
    .filter((part) => part.length >= 18);
}

export function claimIsSupported(claim: string, corpus: string): boolean {
  const haystack = corpus.toLowerCase();
  const words = (claim.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(
    (word) => !STOP.has(word),
  );
  if (words.length === 0) return true;
  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits / words.length >= 0.45;
}

export function scoreGroundedness(answer: string, documents: string[]) {
  const corpus = documents.join("\n\n");
  const claims = splitClaims(answer);
  if (claims.length === 0) {
    return { supported: 0, total: 0, unsupported: [] as string[] };
  }
  const unsupported = claims.filter((claim) => !claimIsSupported(claim, corpus));
  return {
    supported: claims.length - unsupported.length,
    total: claims.length,
    unsupported,
  };
}
