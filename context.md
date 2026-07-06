# Competition Scoring System — CONTEXT

This file describes the architecture, rules, and state model of a real-time competition scoring system built with Firebase Realtime Database and a static frontend (GitHub Pages).

The system is designed for a single ongoing event where judges score contestants in real time.

---

# 1. SYSTEM OVERVIEW

We are building a real-time scoring application with the following properties:

- No backend server
- Firebase Realtime Database as the only backend
- One active competition at a time
- Judges submit scores per round
- Admin is also a judge
- Real-time synchronization between all clients

---

# 2. ROLES

## Judge
- Sees current contestant
- Sees live timer
- Interacts with counter during active round
- Submits score via modal after round ends

## Admin (also a judge)
- Has identical UI to judges
- Additional controls:
  - start round
  - reset round
  - advance to next contestant

---

# 3. FIREBASE DATA MODEL

## LIVE STATE (core system state)

live/
    currentContestant: string | number
    currentRound: number (timestamp)
    timerStart: number (Date.now())
    timerDuration: number (seconds)

RULES:
- currentRound defines a scoring session
- No status flags are used
- Timer is derived from timerStart + timerDuration

---

## CONTESTANTS

contestants/
    {id}/
        name: string

---

## SCORES

scores/
    {contestantId}/
        {roundId}/
            {judgeId}/
                points: number
                overallFeel: number
                submittedAt: number

RULES:
- One score per judge per round
- roundId === live.currentRound
- Scores are immutable per round (can be overwritten per judge before finalization)

---

# 4. CORE CONCEPTS

## Round-based system

A "round" represents one judging cycle for one contestant.

Each round is uniquely identified by:
- live.currentRound (timestamp)

---

## Derived state principle

We do NOT store:
- status
- submittedCount
- isRunning
- isFinished

All state is derived from:
- live object
- scores structure

---

## Firebase is the source of truth

- No local authoritative state
- All clients react to Firebase changes
- UI is a projection of live database state

---

# 5. TIMER SYSTEM

- Timer is NOT server-driven
- Each client calculates remaining time locally:

remaining = timerDuration - (Date.now() - timerStart)

- When remaining <= 0 → round is considered finished
- Timer is purely visual and synchronization helper

---

# 6. COUNTER BEHAVIOR

Counter is active only when round is active:

A round is active if:
- current time is between timerStart and timerStart + timerDuration

Rules:
- Counter disabled before round starts
- Counter disabled after round ends

---

# 7. SCORE SUBMISSION

Scores are submitted via modal after timer ends.

Submission rules:
- Allowed only during active round OR immediately after timer ends
- Must include:
  - points
  - overallFeel
  - judgeId
  - roundId (live.currentRound)

Stored at:
scores/{contestantId}/{roundId}/{judgeId}

---

# 8. ROLE SYSTEM (LIGHTWEIGHT - TEMPORARY)

Current implementation:

Judge identity is passed via URL:

judge.html?judgeId=abc123&admin=1

- judgeId = identity
- admin=1 enables admin controls

IMPORTANT:
- This is NOT secure authentication
- It is a temporary development solution
- Will be replaced by Firebase Auth later

---

# 9. ROUND LIFECYCLE

1. Admin starts round
   - sets live.currentContestant
   - sets live.currentRound (timestamp)
   - sets timerStart and timerDuration

2. Judges receive live update
   - UI updates contestant
   - timer starts locally

3. Judges interact
   - counter active during round

4. Timer ends
   - score modal opens

5. Judges submit scores
   - stored in Firebase under currentRound

6. Admin monitors submissions
   - when all judges submitted:
     → next contestant is triggered

---

# 10. ARCHITECTURE PRINCIPLES

## Firebase-first design
Firebase is the only source of truth.

## Stateless clients
Clients do not decide:
- round transitions
- scoring completion
- timing authority

They only react to live updates.

## Derived state only
We never store computed values like:
- submittedCount
- status flags
- isRoundActive

---

# 11. CURRENT IMPLEMENTATION STATUS

Implemented:
- Firebase connection
- live listener
- contestant display
- timer system
- counter interaction
- score modal
- submitScore function
- judgeId via URL
- admin flag toggle (basic)

---

# 12. MISSING FEATURES (TO IMPLEMENT)

## Admin system
- startRound()
- resetRound()
- nextContestant()

## Auto progression logic
- detect when all judges submitted scores
- automatically advance to next contestant

## Firebase security rules
- restrict writes to scores
- protect live object
- prepare future Firebase Auth migration

## UI improvements
- prevent duplicate submissions
- prevent late submissions
- ensure modal opens once per round only

---

# 13. IMPORTANT NOTE

This system is intentionally designed to be:
- simple
- real-time
- stateless on client side
- Firebase-driven

The core idea is:

"Everything is derived from live.currentRound"


todo
-reset only after it has been pressed 3times in row