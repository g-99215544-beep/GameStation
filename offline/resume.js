// A student who walks out of a station mid-activity — phone locked, tab closed,
// battery pulled — must come back to the same remaining time and the same stage.
// This module owns the shape of that snapshot and the rules for trusting one.
//
// The snapshot is deliberately small: stage counters and, for the two games that
// generate their board randomly, the board itself. It never holds the station
// config or the base64 worksheet images that live on `gameState`.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.StationResume = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const RESUME_KEY_PREFIX = 'gs_station_resume';
  // Matches SESSION_DURATION_MS in app/admin-groups.js: a snapshot cannot outlive the
  // login that produced it.
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;

  function resumeKey(huntId, groupId) {
    return huntId
      ? `${RESUME_KEY_PREFIX}_${huntId}_${groupId}`
      : `${RESUME_KEY_PREFIX}_${groupId}`;
  }

  function buildSnapshot(options) {
    const opts = options || {};
    return {
      huntId: opts.huntId == null ? null : String(opts.huntId),
      groupId: opts.groupId == null ? null : String(opts.groupId),
      stId: opts.stId,
      gameType: String(opts.gameType || ''),
      // Stored as-is. Time spent away is never subtracted — leaving at 6:30
      // remaining means returning at 6:30 remaining.
      timeLeftSec: Math.max(0, Math.round(Number(opts.timeLeftSec) || 0)),
      elapsedSec: Math.max(0, Math.round(Number(opts.elapsedSec) || 0)),
      stage: opts.stage && typeof opts.stage === 'object' ? opts.stage : {},
      ts: opts.now == null ? Date.now() : opts.now
    };
  }

  // A snapshot is only worth restoring when it belongs to this hunt, this group,
  // and the station the journey is actually pointing at. Anything else is a
  // leftover, and replaying it would drop a student into the wrong game.
  function isUsable(snapshot, context) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const ctx = context || {};
    if (String(snapshot.groupId) !== String(ctx.groupId)) return false;
    if (String(snapshot.huntId) !== String(ctx.huntId == null ? null : ctx.huntId)) return false;
    if (String(snapshot.stId) !== String(ctx.stId)) return false;
    if (!snapshot.gameType) return false;
    // Zero left means the timer already expired; the station is over, not paused.
    if (!(Number(snapshot.timeLeftSec) > 0)) return false;
    const maxAge = Number(ctx.maxAgeMs) || MAX_AGE_MS;
    const now = ctx.now == null ? Date.now() : ctx.now;
    if (!(Number(snapshot.ts) > 0) || now - Number(snapshot.ts) > maxAge) return false;
    return true;
  }

  // What each game type contributes to `stage`. Games whose board is generated
  // randomly (crossword, battleship) must carry the generated board, or a
  // "resume" would silently hand the student a different puzzle.
  function captureStage(gameType, gameState) {
    const state = gameState || {};
    switch (gameType) {
      case 'tangram': {
        const tangram = state.tangram || {};
        return { idx: Number(tangram.idx) || 0, done: Number(tangram.done) || 0 };
      }
      case 'sudoku': {
        const sudoku = state.sudoku || {};
        return { stageIndex: Number(sudoku.stageIndex) || 0, completed: Number(sudoku.completed) || 0 };
      }
      case 'lembaran_kerja':
        return { currentQuestion: Number(state.currentQuestion) || 0, correct: Number(state.correct) || 0 };
      case 'crossword': {
        const crossword = state.crossword || {};
        return { puzzle: crossword.puzzle || null, answers: { ...(crossword.answers || {}) } };
      }
      case 'battleship': {
        const bs = state.battleship || {};
        return {
          phase: bs.phase || 'placing',
          playerFleet: bs.playerFleet || [],
          enemyFleet: bs.enemyFleet || [],
          playerShotLog: { ...(bs.playerShotLog || {}) },
          enemyShotLog: { ...(bs.enemyShotLog || {}) },
          round: Number(bs.round) || 1,
          correct: Number(state.correct) || 0
        };
      }
      // `totalSec` is the denominator of the run's time score, so it must be the
      // station's full limit — recomputing it from the clock left on resume
      // would inflate every resumed run's marks.
      case 'jejak_lari':
        return {
          distanceM: Number(state.distanceM) || 0,
          started: Boolean(state.started),
          totalSec: Number(state.totalSec) || 0
        };
      // Sifir restarts its set at question 1 on any wrong answer, so a fresh set
      // on resume is the behaviour students already know.
      default:
        return {};
    }
  }

  return { resumeKey, buildSnapshot, isUsable, captureStage, RESUME_KEY_PREFIX, MAX_AGE_MS };
});
