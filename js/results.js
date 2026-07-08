export function calculateNormalizedResults({ contestants = [], judges = [], scoresByContestant = {} } = {}) {
    const contestantEntries = [...contestants]
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((contestant) => ({
            id: String(contestant.id),
            name: contestant.name
        }));

    const judgeNormalizations = judges
        .map((judge) => {
            const rawScores = contestantEntries
                .map((contestant) => {
                    const score = scoresByContestant?.[contestant.id]?.[String(judge.id)];
                    const rawValue = Number(score?.points ?? 0) + Number(score?.overallFeel ?? 0);
                    return Number.isFinite(rawValue)
                        ? { contestantId: contestant.id, rawValue }
                        : null;
                })
                .filter(Boolean);

            if (rawScores.length === 0) return null;

            const values = rawScores.map((item) => item.rawValue);
            const min = Math.min(...values);
            const max = Math.max(...values);

            return rawScores.reduce((acc, item) => {
                acc[item.contestantId] = max === min ? 100 : ((item.rawValue - min) / (max - min)) * 100;
                return acc;
            }, {});
        })
        .filter(Boolean);

    return contestantEntries
        .map((contestant) => {
            const normalizedScores = judgeNormalizations
                .map((normalizedByContestant) => normalizedByContestant?.[contestant.id])
                .filter((score) => typeof score === "number");

            const averageScore = normalizedScores.length > 0
                ? normalizedScores.reduce((sum, score) => sum + score, 0) / normalizedScores.length
                : null;

            return {
                contestantId: contestant.id,
                contestantName: contestant.name,
                averageScore
            };
        })
        .sort((a, b) => {
            const scoreDiff = (b.averageScore ?? -Infinity) - (a.averageScore ?? -Infinity);
            if (scoreDiff !== 0) return scoreDiff;
            return a.contestantName.localeCompare(b.contestantName);
        });
}

export function formatScore(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return value.toFixed(1);
}
