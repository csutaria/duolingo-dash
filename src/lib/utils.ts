/**
 * SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" with no timezone suffix.
 * V8 parses that as local time, but the value is UTC. Appending Z fixes the parse.
 */
export function parseUtcDate(str: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
    return new Date(str.replace(" ", "T") + "Z");
  }
  return new Date(str);
}
