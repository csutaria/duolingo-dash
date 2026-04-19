export default function AchievementsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Achievements</h2>
      <p className="text-zinc-500">
        Achievement data is not currently available. The Duolingo API field for achievements
        is not reliably populated — use the{" "}
        <a href="/api/debug" className="text-zinc-400 underline hover:text-zinc-200">
          debug endpoint
        </a>{" "}
        in development to inspect the raw API response.
      </p>
    </div>
  );
}
