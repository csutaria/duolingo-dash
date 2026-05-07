export type InstanceRole = "writer" | "manual" | "read-only";

const TRUE_VALUES = new Set(["1", "true", "yes"]);

function truthyEnv(value: string | undefined): boolean {
  return value != null && TRUE_VALUES.has(value.trim().toLowerCase());
}

export function getInstanceRole(): InstanceRole {
  if (truthyEnv(process.env.DUOLINGO_READ_ONLY)) return "read-only";

  const raw = process.env.DUOLINGO_INSTANCE_ROLE?.trim().toLowerCase();
  if (raw === "manual") return "manual";
  if (raw === "read-only" || raw === "readonly") return "read-only";
  return "writer";
}

export function isBackgroundSyncEnabled(): boolean {
  return getInstanceRole() === "writer";
}
