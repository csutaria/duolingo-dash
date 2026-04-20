import {
  DuolingoUser,
  XpSummary,
  VocabOverview,
  LegacyUserData,
  PathSection,
} from "./types";

const BASE_URL = "https://www.duolingo.com";
const API_PREFIX = `${BASE_URL}/2017-06-30`;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const USER_FIELDS = [
  "id",
  "name",
  "username",
  "picture",
  "bio",
  "streak",
  "streakData{currentStreak,previousStreak}",
  "totalXp",
  "xpGoal",
  "xpGoalMetToday",
  "weeklyXp",
  "monthlyXp",
  "gems",
  "lingots",
  "hasPlus",
  "creationDate",
  "currentCourseId",
  "learningLanguage",
  "fromLanguage",
  "motivation",
  "courses{id,title,learningLanguage,fromLanguage,xp,crowns,healthEnabled,preload}",
  "_achievements",
  "achievements",
].join(",");

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = parts[1];
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const decoded = Buffer.from(padded, "base64url").toString("utf-8");
  return JSON.parse(decoded);
}

export class DuolingoClient {
  private jwt: string;
  private userId: number;

  constructor(jwt: string) {
    this.jwt = jwt.trim();
    const payload = decodeJwtPayload(this.jwt);
    const sub = payload.sub;
    if (typeof sub === "number") {
      this.userId = sub;
    } else if (typeof sub === "string") {
      this.userId = parseInt(sub, 10);
    } else {
      throw new Error("JWT does not contain a valid 'sub' claim for user ID");
    }
    if (isNaN(this.userId)) {
      throw new Error("Could not parse user ID from JWT");
    }
  }

  getUserId(): number {
    return this.userId;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.jwt}`,
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: this.headers(),
      redirect: "follow",
    });
    if (res.status === 401) {
      throw new Error("JWT is invalid or expired. Please re-authenticate.");
    }
    if (res.status === 429) {
      throw new Error("Rate limited by Duolingo. Try again in a few minutes.");
    }
    if (!res.ok) {
      throw new Error(`Duolingo API error: ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new Error(`Expected JSON but got ${contentType} from ${url}`);
    }
    return res.json() as Promise<T>;
  }

  async getUser(): Promise<DuolingoUser> {
    const url = `${API_PREFIX}/users/${this.userId}?fields=${USER_FIELDS}`;
    const user = await this.request<DuolingoUser>(url);
    // Duolingo stopped returning learningLanguage/fromLanguage in the courses array.
    // Parse them from the course ID (format: DUOLINGO_{LANG}_{FROM}).
    user.courses = (user.courses ?? []).map((c) => {
      if (c.learningLanguage && c.fromLanguage) return c;
      const withoutPrefix = c.id.replace(/^DUOLINGO_/, "");
      const lastUnderscore = withoutPrefix.lastIndexOf("_");
      if (lastUnderscore === -1) return c;
      return {
        ...c,
        learningLanguage: c.learningLanguage || withoutPrefix.slice(0, lastUnderscore).toLowerCase(),
        fromLanguage: c.fromLanguage || withoutPrefix.slice(lastUnderscore + 1).toLowerCase(),
      };
    });
    return user;
  }

  async getTotalXp(): Promise<number> {
    const url = `${API_PREFIX}/users/${this.userId}?fields=totalXp`;
    const data = await this.request<{ totalXp: number }>(url);
    return data.totalXp;
  }

  async getXpSummaries(
    startDate: string,
    endDate: string,
    timezone: string,
  ): Promise<{ summaries: XpSummary[] }> {
    const url = `${API_PREFIX}/users/${this.userId}/xp_summaries?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(timezone)}`;
    return this.request<{ summaries: XpSummary[] }>(url);
  }

  async getVocabulary(): Promise<VocabOverview> {
    const url = `${BASE_URL}/vocabulary/overview`;
    return this.request<VocabOverview>(url);
  }

  async getLegacyUser(username?: string): Promise<LegacyUserData> {
    const name = username ?? this.cachedUsername;
    if (!name) {
      const user = await this.getUser();
      this.cachedUsername = user.username;
      return this.getLegacyUser(user.username);
    }
    const url = `${BASE_URL}/users/${name}?_=${Date.now()}`;
    return this.request<LegacyUserData>(url);
  }

  private cachedUsername: string | null = null;

  async switchCourse(
    courseId: string,
    learningLanguage: string,
    fromLanguage: string,
  ): Promise<void> {
    const url = `${API_PREFIX}/users/${this.userId}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ courseId, fromLanguage, learningLanguage }),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to switch course: ${res.status} ${res.statusText}`,
      );
    }
  }

  async getRawUserDebug(): Promise<unknown> {
    const extraFields = [
      ...USER_FIELDS.split(","),
      "achievements",
      "earnedAchievements",
      "userAchievements",
      "currentCourse",
      "courses{id,title,learningLanguage,fromLanguage,xp,crowns,healthEnabled,preload,authorId}",
    ];
    const deduped = [...new Set(extraFields)].join(",");
    const url = `${API_PREFIX}/users/${this.userId}?fields=${deduped}`;
    return this.request<unknown>(url);
  }

  async getPathSectioned(): Promise<PathSection[]> {
    const url = `${API_PREFIX}/users/${this.userId}?fields=currentCourse%7BpathSectioned%7D`;
    const data = await this.request<{ currentCourse?: { pathSectioned?: PathSection[] } }>(url);
    return data.currentCourse?.pathSectioned ?? [];
  }

  async getMistakeCount(courseId: string): Promise<number> {
    try {
      const url = `${BASE_URL}/v2/mistakes/users/${this.userId}/courses/${courseId}/count`;
      const data = await this.request<{ count: number }>(url);
      return data.count;
    } catch {
      return 0;
    }
  }
}

let clientInstance: DuolingoClient | null = null;

export function initClient(jwt: string): DuolingoClient {
  clientInstance = new DuolingoClient(jwt);
  return clientInstance;
}

export function getClient(): DuolingoClient | null {
  return clientInstance;
}
