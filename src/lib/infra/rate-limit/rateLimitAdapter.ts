export type RateLimitConsumeInput = {
  scope: string;
  key: string;
  max: number;
  windowMs: number;
};

export type RateLimitConsumeResult = {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
};

export interface RateLimitAdapter {
  consume(input: RateLimitConsumeInput): Promise<RateLimitConsumeResult>;
}
