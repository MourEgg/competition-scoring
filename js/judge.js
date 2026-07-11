import {
    listenLiveState,
    submitScore,
    startRound,
    resetRound,
    getTimerDuration,
    watchSubmissionCount,
    tryAutoAdvance,
    skipCurrentContestant,
    getJudges,
    beginRound,
    hasJudgeSubmitted,
    validateJudgeToken
} from "./database.js";
import { getContestants } from "./database.js";
import { ensureAnonymousAuth, auth } from "./firebase.js";

/**
 * Judge screen main state
 */
let contestantsCache = [];
let currentLive = null;

let judgeId = null;
let judgeToken = null;
let judgeValidated = false;
let isAdmin = false;
let authErrorMessage = "";
let adminJudgeId = null;

/**
 * Counter (local interaction only)
 */
let counter = 0;
let resetPressCount = 0;

/**
 * Timer state
 */
let timerInterval = null;
let submissionUnsubscribe = null;

function getScoreDraftKey() {
    if (!judgeId || !currentLive?.currentRound) return null;
    return `scoreDraft:${judgeId}:${currentLive.currentRound}`;
}

function showJudgeAuthMessage(message) {
    authErrorMessage = message || "";

    const authMessageEl = document.getElementById("judgeAuthMessage");
    if (!authMessageEl) return;

    authMessageEl.textContent = authErrorMessage;
    authMessageEl.style.display = authErrorMessage ? "block" : "none";
}

function saveScoreDraft() {
    const key = getScoreDraftKey();
    if (!key) return;

    const pointsInput = document.getElementById("pointsInput");
    const feelInput = document.getElementById("feelInput");

    const rawPoints = pointsInput?.value?.trim();
    const pointsValue = rawPoints !== "" && Number.isFinite(Number(rawPoints))
        ? Number(rawPoints)
        : counter;

    const rawFeel = feelInput?.value?.trim();
    const draft = {
        points: pointsValue,
        overallFeel: rawFeel !== "" && Number.isFinite(Number(rawFeel)) ? Number(rawFeel) : null,
        contestantId: currentLive?.currentContestant,
        roundId: currentLive?.currentRound
    };

    localStorage.setItem(key, JSON.stringify(draft));
}

function hasRoundStarted(live = currentLive) {
    return Boolean(live && live.timerStart && live.timerStart > 0);
}

function hasRoundEnded(live = currentLive) {
    if (!hasRoundStarted(live)) return false;
    return Date.now() >= live.timerStart + ((live.timerDuration || 0) * 1000);
}

async function ensureScoreModalOpen(live = currentLive) {
    if (!hasRoundEnded(live) || !judgeId || !live?.currentContestant || !live?.currentRound) {
        return false;
    }

    const alreadySubmitted = await hasJudgeSubmitted(String(live.currentContestant), String(live.currentRound), judgeId);
    if (!alreadySubmitted) {
        openScoreModal();
        return true;
    }

    return false;
}

function loadScoreDraft() {
    const key = getScoreDraftKey();
    if (!key) return null;

    try {
        return JSON.parse(localStorage.getItem(key));
    } catch (err) {
        return null;
    }
}

function clearScoreDraft() {
    const key = getScoreDraftKey();
    if (!key) return;
    localStorage.removeItem(key);
}

function restoreDraftInputs() {
    const draft = loadScoreDraft();
    const pointsInput = document.getElementById("pointsInput");
    const feelInput = document.getElementById("feelInput");

    if (typeof draft?.points === "number") {
        counter = draft.points;
    }

    const restoredPoints = typeof draft?.points === "number" ? draft.points : counter;

    if (pointsInput) {
        pointsInput.value = String(restoredPoints);
        pointsInput.disabled = true;
    }

    if (feelInput) {
        feelInput.value = typeof draft?.overallFeel === "number" ? draft.overallFeel : "";
    }

    document.getElementById("button-number").textContent = String(counter);
    updateSubmitButtonState();
}

/**
 * Init application
 */
async function init() {

    judgeId = getJudgeId();
    judgeToken = getJudgeToken();
    isAdmin = getIsAdmin() || isSignedInAdminUser();

    if (judgeId) {
        try {
            await ensureAnonymousAuth();
            judgeValidated = await validateJudgeToken(judgeId, judgeToken || null);
            if (judgeValidated) {
                showJudgeAuthMessage("");
            }
            else {
                showJudgeAuthMessage("This judge link could not be verified. Please ask the event admin for a fresh link.");
            }
        }
        catch (err) {
            console.error("Judge auth failed", err);
            judgeValidated = false;
            showJudgeAuthMessage(err?.message || "Judge sign-in could not be completed.");
        }
    }

    adminJudgeId = await getAdminJudgeId();
    isAdmin = isAdmin || (judgeId && adminJudgeId && String(judgeId) === String(adminJudgeId));

    contestantsCache = await getContestants();

    setupUI();
    await showConfiguredDuration();

    listenLiveState(handleLiveUpdate);
}

init();

/**
 * Parse judge ID from URL
 */
function getJudgeId() {
    return new URLSearchParams(window.location.search).get("judgeId");
}

function getJudgeToken() {
    return new URLSearchParams(window.location.search).get("token");
}

/**
 * Detect admin mode
 */
function getIsAdmin() {
    return new URLSearchParams(window.location.search).get("admin") === "1";
}

function isSignedInAdminUser() {
    if (!auth?.currentUser) return false;
    return auth.currentUser.email === "kubakristan@gmail.com";
}

async function getAdminJudgeId() {
    const judges = await getJudges();
    const adminJudge = judges.find((judge) => {
        const name = String(judge?.name || "").trim().toLowerCase();
        return name === "admin" || name === "judge admin" || name === "admin judge";
    });

    return adminJudge?.id || null;
}

/**
 * Setup UI based on role
 */
function setupUI() {

    const resetBtn = document.getElementById("resetButton");
    const skipRoundBtn = document.getElementById("skipRoundButton");

    if (!isAdmin && resetBtn) {
        resetBtn.style.display = "none";
        skipRoundBtn.style.display = "none";
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", handleResetButtonClick);
        resetBtn.textContent = "Reset";

        skipRoundBtn.addEventListener("click", handleSkipRoundButtonClick);
    }

    document
        .getElementById("counterButton")
        .addEventListener("click", handleCounterClick);

    const feelInput = document.getElementById("feelInput");
    if (feelInput) {
        feelInput.addEventListener("input", () => {
            saveScoreDraft();
            updateSubmitButtonState();
        });
    }

    const submitBtn = document.getElementById("submitScoreBtn");
    if (submitBtn) {
        submitBtn.addEventListener("click", handleSubmitScore);
        submitBtn.disabled = true;
    }

    const modalEl = document.getElementById("scoreModal");
    if (modalEl) {
        modalEl.addEventListener("hidden.bs.modal", async () => {
            await ensureScoreModalOpen();
        });
    }
}

/**
 * Handle live updates from Firebase
 */
async function handleLiveUpdate(live) {

    const previousLive = currentLive;
    currentLive = live;

    const contestant = contestantsCache.find(
        c => c.id == live.currentContestant
    );

    document.getElementById("contestantName").textContent =
        contestant ? contestant.name : "Unknown";

    if (!isRoundActive(live)) {
        clearTimer();
        await showConfiguredDuration(live);
        unsubscribeSubmissionWatch();

        if (!previousLive || previousLive.currentRound !== live.currentRound) {
            counter = 0;
            document.getElementById("button-number").textContent = "0";
            enableSubmissionUI();
            closeModal();
            await ensureScoreModalOpen(live);
        }

        return;
    }

    if (!previousLive || previousLive.currentRound !== live.currentRound) {
        counter = 0;
        document.getElementById("button-number").textContent = "0";
        enableSubmissionUI();
        closeModal();
    }

    startTimer(live.timerStart, live.timerDuration);

    // admin: watch submissions for auto-advance
    if (isAdmin) {
        subscribeSubmissionWatch(String(live.currentContestant), String(live.currentRound));
    }
}

/**
 * Counter click logic
 */
async function handleCounterClick(event) {

    event.preventDefault();
    resetResetButtonPressCount();

    if (!isRoundActive()) {
        if (isAdmin) {
            await startRoundForAdmin();
            return;
        }

        return;
    }

    counter++;
    document.getElementById("button-number").textContent = counter;
    saveScoreDraft();
}

function resetResetButtonPressCount() {
    resetPressCount = 0;

    const resetBtn = document.getElementById("resetButton");
    if (resetBtn) {
        resetBtn.textContent = "Reset";
    }
}

async function handleResetButtonClick(event) {
    event.preventDefault();

    if (!isAdmin) return;

    resetPressCount += 1;

    const resetBtn = document.getElementById("resetButton");
    if (!resetBtn) return;

    if (resetPressCount < 3) {
        resetBtn.textContent = `Reset (${3 - resetPressCount})`;
        return;
    }

    resetResetButtonPressCount();
    await handleReset();
}

async function handleSkipRoundButtonClick(event) {
    event.preventDefault();

    if (!isAdmin) return;

    await handleSkipRound();
}

/**
 * Reset logic (admin only)
 */
async function handleReset() {

    if (!isAdmin) return;

    counter = 0;

    document.getElementById("button-number").textContent = "0";

    clearTimer();

    await resetRound();
    await showConfiguredDuration();
}

async function handleSkipRound() {

    if (!isAdmin) return;

    if (!confirm("Skip current contestant?")) {
        return;
    }

    clearTimer();

    await skipCurrentContestant();
}


/**
 * Submit score to Firebase
 */
async function handleSubmitScore() {

    if (!currentLive || !judgeId || !judgeValidated) {
        const message = "Judge authentication is not ready. Please refresh the page and make sure Anonymous sign-in is enabled in Firebase Authentication.";
        showJudgeAuthMessage(message);
        alert(message);
        return;
    }

    const points = Number(document.getElementById("pointsInput").value);
    const feel = Number(document.getElementById("feelInput").value);

    if (isNaN(points) || !Number.isFinite(points) || isNaN(feel) || !Number.isFinite(feel)) {
        alert("Please enter a valid overall feel score.");
        return;
    }

    try {
        await submitScore({
            contestantId: currentLive.currentContestant,
            roundId: currentLive.currentRound,
            judgeId,
            points,
            overallFeel: feel
        });

        clearScoreDraft();
        markSubmittedUI();
        closeModal();
    }
    catch (err) {
        if (err && err.code === "DUPLICATE") {
            alert("You have already submitted a score for this round.");
            markSubmittedUI();
        }
        else {
            console.error(err);
            alert("Failed to submit score. Try again.");
        }
    }
}

/**
 * Timer logic
 */
function startTimer(startTime, durationSec) {

    if (timerInterval) {
        clearInterval(timerInterval);
    }

    function update() {

        const now = Date.now();

        const elapsed = (now - startTime) / 1000;

        const remaining = durationSec - elapsed;

        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;

            document.getElementById("button-timer").textContent = "0:00";

            renderTimer(0);
            openScoreModal();
            return;
        }

        renderTimer(remaining);
    }

    update();
    timerInterval = setInterval(update, 100);
}

/**
 * Stop timer
 */
function clearTimer() {

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

/**
 * Open modal
 */
function openScoreModal() {
    restoreDraftInputs();

    const modal = new bootstrap.Modal(
        document.getElementById("scoreModal")
    );

    modal.show();
}

/**
 * Close modal
 */
function closeModal() {

    const modalEl = document.getElementById("scoreModal");

    const modal = bootstrap.Modal.getInstance(modalEl);

    if (modal) {
        modal.hide();
    }

    document.getElementById("pointsInput").value = "";
    document.getElementById("feelInput").value = "";
}

function isRoundActive(live = currentLive) {

    if (!live) return false;

    if (!live.timerDuration || live.timerDuration <= 0) return false;

    const now = Date.now();

    const elapsed = (now - live.timerStart) / 1000;

    return elapsed >= 0 && elapsed < live.timerDuration;
}

function updateSubmitButtonState() {
    const submitBtn = document.getElementById("submitScoreBtn");
    const feelInput = document.getElementById("feelInput");
    if (!submitBtn || !feelInput) return;

    const feelValue = feelInput.value.trim();
    submitBtn.disabled = feelValue === "" || !Number.isFinite(Number(feelValue));
}

function unsubscribeSubmissionWatch() {
    if (submissionUnsubscribe) {
        submissionUnsubscribe();
        submissionUnsubscribe = null;
    }
}

function subscribeSubmissionWatch(contestantId, roundId) {
    unsubscribeSubmissionWatch();
    submissionUnsubscribe = watchSubmissionCount(contestantId, roundId, async (count) => {
        try {
            const judges = await getJudges();
            const expected = judges.length;
            if (expected && count >= expected) {
                await tryAutoAdvance(contestantId, roundId);
            }
        }
        catch (err) {
            console.warn('auto-advance watcher error', err);
        }
    });
}

async function startRoundForAdmin() {

    if (!isAdmin) return;

    const currentContestant = currentLive?.currentContestant;
    const currentRound = currentLive?.currentRound;

    if (currentContestant && currentRound && currentLive.timerStart === 0) {
        await beginRound();
        return;
    }

    const defaultContestantId = currentContestant || contestantsCache[0]?.id;

    if (!defaultContestantId) return;

    counter = 0;
    document.getElementById("button-number").textContent = "0";

    await startRound(defaultContestantId);
}

async function resetRoundUI() {
    counter = 0;
    document.getElementById("button-number").textContent = "0";
    clearTimer();
    await showConfiguredDuration();
}

function markSubmittedUI() {
    const submitBtn = document.getElementById("submitScoreBtn");
    const pointsInput = document.getElementById("pointsInput");
    const feelInput = document.getElementById("feelInput");

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitted";
    }

    if (pointsInput) pointsInput.disabled = true;
    if (feelInput) feelInput.disabled = true;
}

function enableSubmissionUI() {
    const submitBtn = document.getElementById("submitScoreBtn");
    const pointsInput = document.getElementById("pointsInput");
    const feelInput = document.getElementById("feelInput");

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit";
    }

    if (pointsInput) {
        pointsInput.disabled = false;
        pointsInput.value = "";
    }

    if (feelInput) {
        feelInput.disabled = false;
        feelInput.value = "";
    }
}

function renderTimer(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = Math.floor(safeSeconds % 60);
    const tenths = Math.floor((safeSeconds * 10) % 10);

    document.getElementById("button-timer").textContent =
        `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

async function showConfiguredDuration(live = currentLive) {
    const configuredDuration = live?.timerDuration ?? await getTimerDuration();
    renderTimer(configuredDuration);
}