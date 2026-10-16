export const ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "UNSUPPORTED",
  "IO",
  "CANCELLED",
  "INTERRUPTED",
  "UNAVAILABLE",
  /** A production engine ran and reported that it could not do the work. */
  "ENGINE_FAILURE",
  /** Data failed a hash or size check against its published value. */
  "INTEGRITY",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Wire format for errors crossing the engine boundary. */
export interface ErrorShape {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** An expected, user-reportable failure. Anything else is treated as INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  toShape(): ErrorShape {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function isErrorShape(value: unknown): value is ErrorShape {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === "string" &&
    typeof candidate.code === "string" &&
    (ERROR_CODES as readonly string[]).includes(candidate.code)
  );
}

export function toErrorShape(error: unknown): ErrorShape {
  if (error instanceof AppError) return error.toShape();
  if (isErrorShape(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return { code: "INTERNAL", message };
}
