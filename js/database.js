import { db, auth } from "./firebase.js";
import {
    ref,
    get,
    set,
    update,
    onValue
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

const PATHS = {
    contestants: "contestants",
    config: "config",
    live: "live",
    judgeSessions: "judgeSessions"
};

// judges collection
PATHS.judges = "judges";

const TIMER_DURATION_KEY = "timerDuration";

function buildRoundState({ contestantId, duration, roundId = Date.now(), timerStart = Date.now() }) {
    return {
        currentContestant: contestantId,
        currentRound: roundId,
        timerStart,
        timerDuration: duration
    };
}

export async function addContestant(name) {

    // load next contestant ID
    const idRef = ref(db, `${PATHS.config}/nextContestantId`);
    const snapshot = await get(idRef);

    const id = snapshot.exists() ? snapshot.val() : 1;

    // create new contestant
    await set(ref(db, `${PATHS.contestants}/${id}`), {
        name,
        createdAt: Date.now()
    });

    // update next contestant ID
    await update(ref(db, PATHS.config), {
        nextContestantId: id + 1
    });

    return id;
}

export async function getContestants() {
    const contestantsRef = ref(db, "contestants");

    const snapshot = await get(contestantsRef);

    if (!snapshot.exists()) {
        return [];
    }

    const data = snapshot.val();

    // convert object -> array
    return Object.entries(data).map(([id, value]) => {
        return {
            id,
            ...value
        };
    });
}

export async function updateContestantName(id, newName) {

    const contestantRef = ref(db, `contestants/${id}`);

    await update(contestantRef, {
        name: newName
    });

}

export function listenLiveState(callback) {

    const liveRef = ref(db, PATHS.live);

    onValue(liveRef, (snapshot) => {

        if (!snapshot.exists()) return;

        callback(snapshot.val());

    });

}

export function listenScores(callback) {
    const scoresRef = ref(db, "scores");

    return onValue(scoresRef, (snapshot) => {
        callback(snapshot.exists() ? snapshot.val() : null);
    });
}

export async function getLiveState() {

    const snapshot = await get(ref(db, PATHS.live));

    if (!snapshot.exists()) {
        return null;
    }

    return snapshot.val();

}

export async function startRound(contestantId, duration = null) {

    const roundId = Date.now();
    const resolvedDuration = duration ?? await getTimerDuration();

    await update(ref(db, PATHS.live), buildRoundState({
        contestantId,
        duration: resolvedDuration,
        roundId
    }));

}

export async function prepareRound(contestantId, duration = null) {
    const roundId = Date.now();
    const resolvedDuration = duration ?? await getTimerDuration();

    await update(ref(db, PATHS.live), {
        currentContestant: contestantId,
        currentRound: roundId,
        timerStart: 0,
        timerDuration: resolvedDuration
    });
}

export async function beginRound() {
    const live = await getLiveState();
    if (!live?.currentContestant || live?.timerStart > 0 || !live?.timerDuration) {
        return;
    }

    await update(ref(db, PATHS.live), {
        timerStart: Date.now()
    });
}

export async function restartRound(duration = null) {

    const live = await getLiveState();

    if (!live?.currentContestant) {
        return;
    }

    await startRound(live.currentContestant, duration);

}

export async function resetRound() {

    const live = await getLiveState();
    const eventDuration = await getTimerDuration();

    await update(ref(db, PATHS.live), {
        currentContestant: live?.currentContestant ?? null,
        currentRound: Date.now(),
        timerStart: 0,
        timerDuration: eventDuration
    });

}

export async function resetEvent() {
    const eventDuration = await getTimerDuration();

    await Promise.all([
        set(ref(db, PATHS.contestants), null),
        set(ref(db, PATHS.judges), null),
        set(ref(db, "scores"), null)
    ]);

    await update(ref(db, PATHS.config), {
        nextContestantId: 1
    });

    await set(ref(db, PATHS.live), {
        currentContestant: null,
        currentRound: Date.now(),
        timerStart: 0,
        timerDuration: eventDuration
    });
}

export async function setTimerDuration(duration) {
    await set(ref(db, `${PATHS.config}/${TIMER_DURATION_KEY}`), duration);
}

export async function getTimerDuration() {
    const snapshot = await get(ref(db, `${PATHS.config}/${TIMER_DURATION_KEY}`));
    return snapshot.exists() ? Number(snapshot.val()) || 150 : 150;
}

export async function startFlight(contestantId, duration) {
    return startRound(contestantId, duration);
}

export async function restartFlight(duration) {
    return restartRound(duration);
}

export async function submitScore({
    contestantId,
    roundId,
    judgeId,
    points,
    overallFeel
}) {

    const scoreRef = ref(
        db,
        `scores/${contestantId}/${roundId}/${judgeId}`
    );

    // Prevent duplicate submission for the same judge/round/contestant
    const existing = await get(scoreRef);
    if (existing.exists()) {
        const err = new Error("DUPLICATE_SUBMISSION");
        err.code = "DUPLICATE";
        throw err;
    }

    await set(scoreRef, {
        points,
        overallFeel,
        submittedAt: Date.now()
    });


}

// expectedJudges removed — derive expected count from /judges

export async function countSubmissions(contestantId, roundId) {
    const snap = await get(ref(db, `scores/${contestantId}/${roundId}`));
    if (!snap.exists()) return 0;
    const data = snap.val();
    return Object.keys(data).length;
}

export async function getScoresForRound(roundId = null) {
    const snapshot = await get(ref(db, "scores"));
    if (!snapshot.exists()) return {};

    const data = snapshot.val() || {};
    const availableRoundIds = [];

    Object.values(data).forEach((contestantRounds) => {
        if (!contestantRounds || typeof contestantRounds !== "object") return;

        Object.keys(contestantRounds).forEach((candidateRoundId) => {
            if (!availableRoundIds.includes(candidateRoundId)) {
                availableRoundIds.push(candidateRoundId);
            }
        });
    });

    const resolvedRoundId = roundId && availableRoundIds.includes(String(roundId))
        ? String(roundId)
        : availableRoundIds
            .map((id) => Number(id))
            .filter(Number.isFinite)
            .sort((a, b) => a - b)
            .map((id) => String(id))
            .pop();

    if (!resolvedRoundId) return {};

    const roundScores = {};

    Object.entries(data).forEach(([contestantId, contestantRounds]) => {
        if (contestantRounds?.[resolvedRoundId]) {
            roundScores[contestantId] = contestantRounds[resolvedRoundId];
        }
    });

    return roundScores;
}

export async function getScoresForContestantRound(contestantId, roundId) {
    if (!contestantId || !roundId) return {};

    const snapshot = await get(ref(db, `scores/${contestantId}/${roundId}`));
    return snapshot.exists() ? snapshot.val() : {};
}

export async function getLatestScoresByContestant(contestantIds = []) {
    if (!Array.isArray(contestantIds) || contestantIds.length === 0) return {};

    const scoresByContestant = {};
    const requests = contestantIds.map(async (contestantId) => {
        const id = String(contestantId);
        if (!id) return;

        const { scores } = await getContestantScoreRound(id, null);
        if (scores && Object.keys(scores).length > 0) {
            scoresByContestant[id] = scores;
        }
    });

    await Promise.all(requests);
    return scoresByContestant;
}

export async function getContestantScoreRound(contestantId, preferredRoundId = null) {
    if (!contestantId) return { roundId: null, scores: {} };

    const snapshot = await get(ref(db, `scores/${contestantId}`));
    if (!snapshot.exists()) return { roundId: null, scores: {} };

    const data = snapshot.val() || {};
    const roundIds = Object.keys(data)
        .map((id) => Number(id))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    if (preferredRoundId && data[String(preferredRoundId)]) {
        return { roundId: String(preferredRoundId), scores: data[String(preferredRoundId)] };
    }

    const latestRoundId = roundIds.length > 0 ? String(roundIds[roundIds.length - 1]) : null;
    return {
        roundId: latestRoundId,
        scores: latestRoundId ? data[latestRoundId] : {}
    };
}

export async function setJudgeScore({ contestantId, roundId, judgeId, points, overallFeel }) {
    if (!contestantId || !roundId || !judgeId) return;

    const scoreRef = ref(db, `scores/${contestantId}/${roundId}/${judgeId}`);
    const payload = {};

    if (points !== null && points !== undefined && points !== "") {
        payload.points = Number(points);
    }

    if (overallFeel !== null && overallFeel !== undefined && overallFeel !== "") {
        payload.overallFeel = Number(overallFeel);
    }

    if (Object.keys(payload).length === 0) {
        await set(scoreRef, null);
        return;
    }

    await update(scoreRef, payload);
}

export async function deleteJudgeScore(contestantId, roundId, judgeId) {
    if (!contestantId || !roundId || !judgeId) return;
    await set(ref(db, `scores/${contestantId}/${roundId}/${judgeId}`), null);
}

async function advanceToNextContestant() {

    const contestantsSnap = await get(ref(db, PATHS.contestants));
    if (!contestantsSnap.exists()) return;

    const contestantsObj = contestantsSnap.val();
    const ids = Object.keys(contestantsObj).sort((a, b) => Number(a) - Number(b));

    if (ids.length === 0) return;

    const live = await getLiveState();
    const currentId = String(live?.currentContestant ?? ids[0]);

    const idx = ids.indexOf(currentId);

    if (idx === -1) return;

    if (idx >= ids.length - 1) {
        return;
    }

    await prepareRound(ids[idx + 1]);
}

export async function tryAutoAdvance(contestantId, roundId) {

    const judges = await getJudges();
    const expected = judges.length;

    if (!expected) return;

    const count = await countSubmissions(contestantId, roundId);

    if (count < expected) return;

    await advanceToNextContestant();
}

export async function skipCurrentContestant() {
    await advanceToNextContestant();
}

export function watchSubmissionCount(contestantId, roundId, callback) {
    const scoresRef = ref(db, `scores/${contestantId}/${roundId}`);
    const unsubscribe = onValue(scoresRef, (snap) => {
        if (!snap.exists()) {
            callback(0);
            return;
        }
        const val = snap.val();
        const count = Object.keys(val).length;
        callback(count);
    });

    // return unsubscribe
    return unsubscribe;
}

function makeToken(len = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let t = '';
    for (let i = 0; i < len; i++) t += chars[Math.floor(Math.random() * chars.length)];
    return t;
}

export async function addJudge(name) {
    const token = makeToken(10);
    const pushRef = ref(db, `${PATHS.judges}`);
    // use push to generate id
    const newRef = await set(ref(db, `${PATHS.judges}/${Date.now()}`), {
        name,
        inviteToken: token,
        createdAt: Date.now()
    });

    // return the id we used
    return String(Date.now());
}

export async function getJudges() {
    const snap = await get(ref(db, PATHS.judges));
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.entries(data).map(([id, value]) => ({ id, ...value }));
}

export async function getJudgeById(judgeId) {
    if (!judgeId) return null;
    const snap = await get(ref(db, `${PATHS.judges}/${judgeId}`));
    return snap.exists() ? snap.val() : null;
}

export async function validateJudgeToken(judgeId, token = null) {
    if (!judgeId) return false;

    const judge = await getJudgeById(judgeId);
    if (!judge) return false;

    if (token && judge.inviteToken !== token) {
        return false;
    }

    const activeUid = auth?.currentUser?.uid;
    if (!activeUid) return false;

    await set(ref(db, `${PATHS.judgeSessions}/${activeUid}`), {
        judgeId,
        createdAt: Date.now(),
        inviteToken: token ?? null
    });

    return true;
}

export async function deleteJudge(id) {
    await set(ref(db, `${PATHS.judges}/${id}`), null);
}

export async function hasJudgeSubmitted(contestantId, roundId, judgeId) {
    const snapshot = await get(ref(db, `scores/${contestantId}/${roundId}/${judgeId}`));
    return snapshot.exists();
}