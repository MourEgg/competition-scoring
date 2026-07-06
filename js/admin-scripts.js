import { addContestant, getContestants, updateContestantName, getTimerDuration, setTimerDuration, addJudge, getJudges, deleteJudge, listenLiveState, listenScores, getLiveState, getLatestScoresByContestant, getContestantScoreRound, setJudgeScore, deleteJudgeScore, resetEvent } from "./database.js";
import { calculateNormalizedResults, formatScore } from "./results.js";
import { getAuthState, onAuthStateChange, signInWithGoogle, signOutAdmin } from "./firebase.js";

let contestantsCache = [];
let judgesCache = [];
let timerDuration = 150;
let liveState = null;
let renderVersion = 0;
let renderQueue = Promise.resolve();
let isAdminAccess = false;

const resultsBody = document.getElementById("resultsTableBody");
const authStatus = document.getElementById("authStatus");
const authMessage = document.getElementById("authMessage");
const adminContent = document.getElementById("adminContent");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const googleLogoutBtn = document.getElementById("googleLogoutBtn");

const form = document.getElementById("addContestantForm");

if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!isAdminAccess) {
            alert("Please sign in as the admin first.");
            return;
        }

        const input = document.getElementById("contestantName");

        const name = input.value.trim();

        if (!name)
            return;

        try {
            const id = await addContestant(name);
            await loadContestants();

            console.log(`Přidán soutěžící ${id}`);

            input.value = "";
        }
        catch (err) {
            console.error(err);
            alert("Nepodařilo se uložit soutěžícího.");
        }
    });
}

const tbody = document.getElementById("contestantsTableBody");

async function renderContestants(contestants) {
    const currentVersion = ++renderVersion;

    renderQueue = renderQueue.then(async () => {
        const orderedJudges = sortJudges(judgesCache);
        const scoresByContestant = await getLatestScoresByContestant(
            contestants.map((contestant) => String(contestant.id))
        );

        if (currentVersion !== renderVersion) {
            return;
        }

        tbody.innerHTML = "";

        contestants
            .sort((a, b) => Number(a.id) - Number(b.id))
            .forEach(c => {
                const contestantScores = scoresByContestant[String(c.id)] || {};

                const pointsRows = orderedJudges.map(j => {
                    const scoreEntry = contestantScores[String(j.id)];
                    return `<div class="score-row">${scoreEntry?.points ?? "—"}</div>`;
                }).join("");

                const feelRows = orderedJudges.map(j => {
                    const scoreEntry = contestantScores[String(j.id)];
                    const feelValue = scoreEntry?.overallFeel ?? "—";
                    return `<div class="score-row">${feelValue}</div>`;
                }).join("");

                const tr = document.createElement("tr");

                tr.innerHTML = `
                    <td>${c.name}</td>

                    <td>
                        <div class="score-stack">
                            ${pointsRows || '<div class="score-row">—</div>'}
                        </div>
                    </td>

                    <td>
                        <div class="score-stack">
                            ${feelRows || '<div class="score-row">—</div>'}
                        </div>
                    </td>

                    <td>
                        <button class="btn btn-primary edit-btn" data-id="${c.id}">
                            Edit
                        </button>
                    </td>
                `;

                tbody.appendChild(tr);
            });
    });

    await renderQueue;
}

async function renderResults() {
    if (!resultsBody) return;

    const scoresByContestant = await getLatestScoresByContestant(
        contestantsCache.map((contestant) => String(contestant.id))
    );

    const computedResults = calculateNormalizedResults({
        contestants: contestantsCache,
        judges: judgesCache,
        scoresByContestant
    });

    resultsBody.innerHTML = computedResults.length === 0
        ? '<tr><td colspan="3">No results yet</td></tr>'
        : computedResults.map((result, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(result.contestantName)}</td>
                <td>${formatScore(result.averageScore)}</td>
            </tr>
        `).join("");
}

async function loadContestants() {
    contestantsCache = await getContestants();
    await renderContestants(contestantsCache);
    await renderResults();
}

function updateAuthUI() {
    const state = getAuthState();
    const isSignedIn = Boolean(state?.user);
    const isReady = !state?.loading;

    isAdminAccess = Boolean(state?.isAdmin);

    if (authStatus) {
        if (!isReady) {
            authStatus.textContent = "Checking Google sign-in...";
        }
        else if (!isSignedIn) {
            authStatus.textContent = "Please sign in with Google to manage this event.";
        }
        else if (!isAdminAccess) {
            authStatus.textContent = state?.error || "This Google account is not allowed to manage the admin area.";
        }
        else {
            authStatus.textContent = `Signed in as ${state.user?.displayName || state.user?.email || "admin"}`;
        }
    }

    if (authMessage) {
        authMessage.className = `alert ${isAdminAccess ? "alert-success" : "alert-info"}`;
        authMessage.textContent = isAdminAccess
            ? "Admin access enabled. You can manage contestants, judges, and the event." 
            : "Sign in with Google to access the admin panel.";
    }

    if (adminContent) {
        adminContent.style.display = isAdminAccess ? "block" : "none";
    }

    if (googleLoginBtn) {
        googleLoginBtn.style.display = isAdminAccess ? "none" : "inline-block";
    }

    if (googleLogoutBtn) {
        googleLogoutBtn.style.display = isAdminAccess ? "inline-block" : "none";
    }
}

async function loadAdminData() {
    await loadJudges();
    await loadContestants();
    await loadTimerDuration();
    setupTimerModal();
    setupJudgeForm();
    setupResetEventButton();

    liveState = await getLiveState();

    listenLiveState(async (nextLiveState) => {
        liveState = nextLiveState;
        await renderContestants(contestantsCache);
        await renderResults();
    });

    listenScores(async () => {
        await renderContestants(contestantsCache);
        await renderResults();
    });
}

async function initAdmin() {
    updateAuthUI();

    onAuthStateChange((state) => {
        updateAuthUI();

        if (state?.isAdmin) {
            loadAdminData().catch((err) => {
                console.error(err);
                alert("Unable to load the admin dashboard.");
            });
        }
    });

    if (googleLoginBtn) {
        googleLoginBtn.addEventListener("click", async () => {
            try {
                await signInWithGoogle();
                updateAuthUI();
            }
            catch (err) {
                console.error(err);
                alert(err?.message || "Google sign-in failed.");
            }
        });
    }

    if (googleLogoutBtn) {
        googleLogoutBtn.addEventListener("click", async () => {
            await signOutAdmin();
            updateAuthUI();
        });
    }
}

initAdmin();

function setupTimerModal() {
    const timerDisplay = document.querySelector(".timer-wrapper span:nth-of-type(2)");
    const timerInput = document.getElementById("timerDurationInput");
    const saveTimerBtn = document.getElementById("saveTimerBtn");

    if (!timerDisplay || !timerInput || !saveTimerBtn) return;

    timerInput.value = timerDuration;
    timerDisplay.textContent = formatDuration(timerDuration);

    saveTimerBtn.addEventListener("click", async () => {
        const value = Number(timerInput.value);
        if (!Number.isFinite(value) || value <= 0) return;

        timerDuration = value;
        await setTimerDuration(timerDuration);
        timerDisplay.textContent = formatDuration(timerDuration);

        const modalEl = document.getElementById("timerModal");
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) {
            modal.hide();
        }
    });
}

async function loadTimerDuration() {
    timerDuration = await getTimerDuration();

    const timerDisplay = document.querySelector(".timer-wrapper span:nth-of-type(2)");
    const timerInput = document.getElementById("timerDurationInput");

    if (timerDisplay) {
        timerDisplay.textContent = formatDuration(timerDuration);
    }

    if (timerInput) {
        timerInput.value = timerDuration;
    }
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function sortJudges(judges) {
    return [...judges].sort((a, b) => {
        const aOrder = Number(a.createdAt ?? a.id ?? 0);
        const bOrder = Number(b.createdAt ?? b.id ?? 0);
        return aOrder - bOrder;
    });
}

async function loadJudges() {
    judgesCache = sortJudges(await getJudges());
    renderJudges(judgesCache);
    await renderResults();
}

function setupJudgeForm() {
    const form = document.getElementById('addJudgeForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!isAdminAccess) {
            alert("Please sign in as the admin first.");
            return;
        }

        const input = document.getElementById('judgeNameInput');
        const name = input.value.trim();
        if (!name) return;
        const id = await addJudge(name);
        input.value = '';
        await loadJudges();
    });
}

function setupResetEventButton() {
    const resetButton = document.querySelector('.event-reset');
    if (!resetButton) return;

    resetButton.addEventListener('click', async () => {
        if (!isAdminAccess) {
            alert("Please sign in as the admin first.");
            return;
        }

        const confirmed = confirm('Resetting the event will permanently remove all contestants, judges, and scores. This cannot be undone. Continue?');
        if (!confirmed) return;

        try {
            await resetEvent();
            await loadJudges();
            await loadContestants();
            liveState = await getLiveState();
        }
        catch (err) {
            console.error(err);
            alert('Could not reset the event. Please try again.');
        }
    });
}

function renderJudges(judges) {
    const tbody = document.getElementById('judgesTableBody');
    tbody.innerHTML = '';
    judges.forEach(j => {
        const tr = document.createElement('tr');
        const inviteUrl = `${location.origin}${location.pathname.replace(/admin.html$/, 'index.html') || '/index.html'}?judgeId=${encodeURIComponent(j.id)}&token=${encodeURIComponent(j.inviteToken)}`;
        tr.innerHTML = `
            <td>${j.name}</td>
            <td>
                <input class="form-control" value="${inviteUrl}" readonly style="display:inline-block; width:80%"/>
                <button class="btn btn-sm btn-outline-secondary copy-link" data-link="${inviteUrl}">Copy</button>
            </td>
            <td>
                <button class="btn btn-danger delete-judge" data-id="${j.id}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.copy-link').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const link = btn.dataset.link;
            try { await navigator.clipboard.writeText(link); alert('Copied'); } catch { alert(link); }
        });
    });

    tbody.querySelectorAll('.delete-judge').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = btn.dataset.id;
            if (!confirm('Delete this judge?')) return;
            await deleteJudge(id);
            await loadJudges();
        });
    });
}

// expected-judges removed: derive expected count from /judges

tbody.addEventListener("click", (e) => {

    const btn = e.target.closest(".edit-btn");

    if (!btn) return;

    const id = btn.dataset.id;

    openEditModal(id);

});

let editingId = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");
}

async function openEditModal(id) {

    editingId = id;

    const input = document.getElementById("editNameInput");
    const scoresContainer = document.getElementById("editScoresContainer");

    const contestant = contestantsCache.find(c => c.id == id);
    input.value = contestant ? contestant.name : "";

    scoresContainer.innerHTML = "";

    const orderedJudges = sortJudges(judgesCache);
    const { roundId, scores } = await getContestantScoreRound(String(id), liveState?.currentRound ? String(liveState.currentRound) : null);
    const contestantScores = scores || {};

    orderedJudges.forEach(j => {
        const scoreEntry = contestantScores[String(j.id)] || {};
        const row = document.createElement("div");
        row.className = "edit-row";
        row.innerHTML = `
            <span style="min-width: 120px;">${escapeHtml(j.name)}</span>
            <input type="number" class="form-control" data-field="points" data-judge-id="${j.id}" placeholder="Points" value="${scoreEntry?.points ?? ""}">
            <input type="number" class="form-control" data-field="overallFeel" data-judge-id="${j.id}" placeholder="Overall feel" value="${scoreEntry?.overallFeel ?? ""}">
        `;
        scoresContainer.appendChild(row);
    });

    const modal = new bootstrap.Modal(document.getElementById("editModal"));
    modal.show();
}

document.getElementById("saveEditBtn").addEventListener("click", async () => {

    const input = document.getElementById("editNameInput");
    const newName = input.value.trim();
    const { roundId } = await getContestantScoreRound(String(editingId), liveState?.currentRound ? String(liveState.currentRound) : null);

    if (!editingId) return;

    if (newName) {
        await updateContestantName(editingId, newName);
    }

    if (roundId) {
        const scoreRows = Array.from(document.querySelectorAll("#editScoresContainer [data-field]"));
        const groupedRows = scoreRows.reduce((acc, el) => {
            const judgeId = el.dataset.judgeId;
            if (!judgeId) return acc;
            if (!acc[judgeId]) acc[judgeId] = {};
            acc[judgeId][el.dataset.field] = el.value;
            return acc;
        }, {});

        for (const [judgeId, values] of Object.entries(groupedRows)) {
            const pointsValue = values.points ?? "";
            const feelValue = values.overallFeel ?? "";

            if (pointsValue === "" && feelValue === "") {
                await deleteJudgeScore(String(editingId), String(roundId), judgeId);
                continue;
            }

            await setJudgeScore({
                contestantId: String(editingId),
                roundId: String(roundId),
                judgeId,
                points: pointsValue === "" ? null : pointsValue,
                overallFeel: feelValue === "" ? null : feelValue
            });
        }
    }

    const modalEl = document.getElementById("editModal");
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();

    await loadContestants(); // refresh table
    await renderResults();
});