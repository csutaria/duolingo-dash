export const ACTIVE_COURSE_CONFLICT_ERROR = "Active course changed outside this sync";

export class ActiveCourseConflictError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super(ACTIVE_COURSE_CONFLICT_ERROR);
    this.name = "ActiveCourseConflictError";
    this.details = details;
  }
}

export function isActiveCourseConflictError(err: unknown): err is ActiveCourseConflictError {
  return err instanceof ActiveCourseConflictError;
}

export function isActiveCourseConflictResult(result: { error?: string } | null | undefined): boolean {
  return result?.error === ACTIVE_COURSE_CONFLICT_ERROR;
}
