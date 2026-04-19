export interface DuolingoUser {
  id: number;
  username: string;
  name: string;
  picture: string;
  bio: string;
  streak: number;
  streakData: {
    currentStreak: {
      startDate: string;
      length: number;
      endDate: string;
    } | null;
    previousStreak: {
      startDate: string;
      length: number;
      endDate: string;
    } | null;
  };
  totalXp: number;
  xpGoal: number;
  xpGoalMetToday: boolean;
  weeklyXp: number;
  monthlyXp: number;
  gems: number;
  lingots: number;
  hasPlus: boolean;
  creationDate: number;
  currentCourseId: string;
  learningLanguage: string;
  fromLanguage: string;
  motivation: string;
  courses: DuolingoCourse[];
  _achievements: DuolingoAchievement[];
}

export interface DuolingoCourse {
  id: string;
  title: string;
  learningLanguage: string;
  fromLanguage: string;
  xp: number;
  crowns: number;
  healthEnabled: boolean;
  preload: boolean;
}

export interface DuolingoAchievement {
  name: string;
  description?: string;
  achievementId?: string;
  tier?: number;
  isCompleted?: boolean;
}

export interface XpSummary {
  gainedXp: number | null;
  frozen: boolean | null;
  streakExtended: boolean | null;
  dailyGoalXp: number | null;
  date: number | null;
  numSessions: number | null;
  totalSessionTime: number | null;
  repaired?: boolean;
}

export interface VocabWord {
  word_string: string;
  strength_bars: number;
  last_practiced: string;
  last_practiced_ms: number;
  skill: string;
  pos: string;
  gender: string;
  related_lexemes: string[];
  skill_url_title: string;
  lexeme_id: string;
  normalized_string: string;
}

export interface VocabOverview {
  language_string: string;
  learning_language: string;
  from_language: string;
  language_strength: number;
  vocab_overview: VocabWord[];
}

export interface LegacySkill {
  name: string;
  id: string;
  learned: boolean;
  strength: number;
  words: string[];
  levels_finished: number;
  progress_percent: number;
  url_title: string;
  title: string;
  short_name: string;
  finishedLevels: number;
  accessible: boolean;
  num_lexemes: number;
  dependencies: string[];
  coords_y: number;
  coords_x: number;
}

export interface LegacyLanguageData {
  skills: LegacySkill[];
  calendar: Array<{
    datetime: number;
    improvement: number;
    event_type: string;
    skill_title?: string;
  }>;
  level: number;
  points: number;
  streak: number;
  language_string: string;
  language: string;
  to_next_level: number;
  current_learning: boolean;
}

export interface LegacyUserData {
  username: string;
  language_data: Record<string, LegacyLanguageData>;
  languages: Array<{
    language_string: string;
    language: string;
    current_learning: boolean;
    learning: boolean;
  }>;
}

export interface SyncStatus {
  lastSync: string | null;
  lastFullSync: string | null;
  isStale: boolean;
  error: string | null;
}

export interface SnapshotRow {
  id: number;
  course_id: string;
  snapshot_time: string;
  total_xp: number;
  crowns: number;
  streak: number;
  level: number | null;
}

export interface VocabSnapshotRow {
  id: number;
  snapshot_time: string;
  course_id: string;
  word: string;
  lexeme_id: string;
  strength_bars: number;
  skill: string;
  pos: string;
  gender: string;
  last_practiced: string;
  first_seen: string;
}

export interface SkillSnapshotRow {
  id: number;
  snapshot_time: string;
  course_id: string;
  skill_id: string;
  skill_name: string;
  learned: number;
  strength: number;
  words_json: string;
  levels_finished: number;
  coords_x: number;
  coords_y: number;
  dependencies_json: string;
  first_seen: string;
}
