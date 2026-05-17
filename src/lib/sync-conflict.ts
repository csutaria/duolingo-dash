export const ACTIVE_COURSE_CONFLICT_ERROR = "Active course changed outside this sync";
export const XP_CONFLICT_ERROR = "XP changed outside this sync";

export type AccountConflictKind = "active_course" | "xp";

export class AccountConflictError extends Error {
  readonly details: string[];
  readonly kind: AccountConflictKind;

  constructor(message: string, details: string[], kind: AccountConflictKind) {
    super(message);
    this.name = "AccountConflictError";
    this.details = details;
    this.kind = kind;
  }
}

export class ActiveCourseConflictError extends AccountConflictError {
  constructor(details: string[]) {
    super(ACTIVE_COURSE_CONFLICT_ERROR, details, "active_course");
    this.name = "ActiveCourseConflictError";
  }
}

export class XpConflictError extends AccountConflictError {
  constructor(details: string[]) {
    super(XP_CONFLICT_ERROR, details, "xp");
    this.name = "XpConflictError";
  }
}

export function isAccountConflictError(err: unknown): err is AccountConflictError {
  return err instanceof AccountConflictError;
}

export function isActiveCourseConflictError(err: unknown): err is ActiveCourseConflictError {
  return err instanceof ActiveCourseConflictError;
}

export function isXpConflictError(err: unknown): err is XpConflictError {
  return err instanceof XpConflictError;
}

export function isAccountConflictResult(result: { error?: string } | null | undefined): boolean {
  return result?.error === ACTIVE_COURSE_CONFLICT_ERROR || result?.error === XP_CONFLICT_ERROR;
}

export function isActiveCourseConflictResult(result: { error?: string } | null | undefined): boolean {
  return result?.error === ACTIVE_COURSE_CONFLICT_ERROR;
}
