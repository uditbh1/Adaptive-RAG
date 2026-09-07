export type HopMetric = {
  name: string;
  ms: number;
  tokens?: number;
};

export async function timeHop<T>(
  name: string,
  work: () => Promise<T>,
  tokens?: () => number | undefined,
): Promise<{ result: T; metrics: HopMetric[] }> {
  const started = Date.now();
  const result = await work();
  return {
    result,
    metrics: [
      {
        name,
        ms: Date.now() - started,
        tokens: tokens?.(),
      },
    ],
  };
}

export function tokensFromMessage(message: unknown): number | undefined {
  if (!message || typeof message !== "object") return undefined;
  const usage = (message as { usage_metadata?: { total_tokens?: number } })
    .usage_metadata;
  return typeof usage?.total_tokens === "number" ? usage.total_tokens : undefined;
}
