import { NextResponse } from "next/server";

export type AiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INSUFFICIENT_TOKENS"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_VALIDATION_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_UNKNOWN"
  | "INTERNAL_ERROR";

type ErrorShape = {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
};

type ResponseOptions = {
  status?: number;
  headers?: Record<string, string>;
};

export const aiOk = <T extends Record<string, unknown>>(
  data: T,
  legacy?: Record<string, unknown>,
  options: ResponseOptions = {}
) =>
  NextResponse.json(
    {
      ok: true,
      data,
      error: null,
      success: true,
      ...(legacy || {}),
    },
    {
      status: options.status ?? 200,
      headers: options.headers,
    }
  );

export const aiError = (
  error: ErrorShape,
  options: ResponseOptions = {},
  legacy?: Record<string, unknown>
) =>
  NextResponse.json(
    {
      ok: false,
      data: null,
      error,
      success: false,
      ...(legacy || {}),
    },
    {
      status: options.status ?? 400,
      headers: options.headers,
    }
  );
