// Stable error codes shared by every command. The exit-code mapping is part of
// the CLI contract (spec: 1 domain, 2 usage [commander's], 3 auth, 4 vault I/O)
// and the `code` string is what lands in the JSON error envelope.
export type MenvErrorCode =
  | "VALIDATION"
  | "PARSE"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "BLOCKED"
  | "AUTH_MISSING"
  | "AUTH_FAILED"
  | "VAULT_IO";

const EXIT_CODES: Record<MenvErrorCode, number> = {
  VALIDATION: 1,
  PARSE: 1,
  NOT_FOUND: 1,
  AMBIGUOUS: 1,
  BLOCKED: 1,
  AUTH_MISSING: 3,
  AUTH_FAILED: 3,
  VAULT_IO: 4,
};

export class MenvError extends Error {
  readonly code: MenvErrorCode;
  readonly details?: unknown;

  constructor(code: MenvErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "MenvError";
    this.code = code;
    this.details = details;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}
