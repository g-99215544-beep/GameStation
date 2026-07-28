(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.CannonEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_HP = 50;
  const MAX_HP = 100;
  const MAX_CANNONS = 6;
  const DEFAULT_DAMAGE = 10;
  const MAX_DAMAGE = 50;
  // The four fields a student's phone must never write back. Its cached copy of
  // `progress` goes stale the moment somebody shoots them, so writing these
  // would restore HP the shooter had already knocked down.
  const CANNON_FIELDS = ['hp', 'ammo', 'claimed', 'incoming'];

  function readHp(progress) {
    if (!progress || progress.hp == null) return MAX_HP;
    const hp = Number(progress.hp);
    if (!Number.isFinite(hp)) return MAX_HP;
    return Math.min(MAX_HP, Math.max(MIN_HP, hp));
  }

  function readAmmo(progress) {
    const ammo = Math.floor(Number(progress && progress.ammo));
    return Number.isFinite(ammo) && ammo > 0 ? ammo : 0;
  }

  function clampDamage(value) {
    // Treat null, undefined, and whitespace-only strings as DEFAULT_DAMAGE
    if (value == null || (typeof value === 'string' && !value.trim())) return DEFAULT_DAMAGE;
    const damage = Math.round(Number(value));
    if (!Number.isFinite(damage)) return DEFAULT_DAMAGE;
    return Math.min(MAX_DAMAGE, Math.max(1, damage));
  }

  function applyDamage(hp, damagePercent) {
    return Math.max(MIN_HP, readHp({ hp: hp }) - clampDamage(damagePercent));
  }

  function effectiveScore(totalScore, hp) {
    return Math.round((Number(totalScore) || 0) * readHp({ hp: hp }) / 100);
  }

  function finalScore(totalScore, hp, finishBonus) {
    return effectiveScore(totalScore, hp) + (Number(finishBonus) || 0);
  }

  function isInBattle(progress) {
    return !progress || progress.status !== 'won';
  }

  function hasClaimed(progress, cid) {
    return Boolean(progress && progress.claimed && progress.claimed[cid]);
  }

  function claimBullet(progress, cid, now) {
    if (hasClaimed(progress, cid)) return null;
    const claimed = Object.assign({}, (progress && progress.claimed) || {});
    claimed[cid] = now == null ? Date.now() : now;
    return { ammo: readAmmo(progress) + 1, claimed: claimed };
  }

  function summarizeIncoming(incoming) {
    const ids = Object.keys(incoming || {});
    if (!ids.length) return null;
    let latest = null;
    let lowest = MAX_HP;
    ids.forEach(function (id) {
      const hit = incoming[id] || {};
      if (!latest || (Number(hit.ts) || 0) >= (Number(latest.ts) || 0)) latest = hit;
      lowest = Math.min(lowest, readHp({ hp: hit.hpAfter }));
    });
    return {
      ids: ids,
      count: ids.length,
      from: latest && latest.from != null ? String(latest.from) : null,
      hpAfter: lowest
    };
  }

  // What "100% correct" means, per game type. The percentage-scored games top
  // out at 100. Tangram scores out of 200 (three shapes at 40, plus up to 80
  // for speed), so the bar is all three shapes with no speed requirement.
  // Sifir and Jejak Lari derive their score from the time left and can almost
  // never reach 100, so for them success is the onTime flag plus a non-zero
  // score — both games score exactly 0 when the student fails.
  const PASS_SCORE = {
    lembaran_kerja: 100, quiz: 100, pilihan: 100,
    sudoku: 100, crossword: 100, battleship: 100,
    tangram: 120,
    sifir: 1, jejak_lari: 1
  };

  function isPerfect(gameType, score, onTime) {
    if (!onTime) return false;
    const needed = PASS_SCORE[gameType] == null ? 100 : PASS_SCORE[gameType];
    return (Number(score) || 0) >= needed;
  }

  function stripCannonFields(payload) {
    const out = Object.assign({}, payload || {});
    CANNON_FIELDS.forEach(function (field) { delete out[field]; });
    return out;
  }

  function findByPassword(cannons, password) {
    const wanted = String(password || '').trim().toUpperCase();
    if (!wanted) return null;
    const match = Object.keys(cannons || {}).find(function (cid) {
      const cannon = cannons[cid] || {};
      return String(cannon.password || '').toUpperCase() === wanted;
    });
    return match == null ? null : match;
  }

  function passwordConflicts(stations, cannons) {
    const seen = new Map();
    const conflicts = [];
    Object.keys(stations || {}).forEach(function (sid) {
      const station = stations[sid] || {};
      const key = String(station.password || '').toUpperCase();
      if (key) seen.set(key, 'Stesen ' + (station.id == null ? sid : station.id));
    });
    Object.keys(cannons || {}).forEach(function (cid) {
      const cannon = cannons[cid] || {};
      const key = String(cannon.password || '').toUpperCase();
      if (!key) return;
      const label = 'Meriam ' + (cannon.id == null ? cid : cannon.id);
      if (seen.has(key)) conflicts.push({ password: cannon.password, a: seen.get(key), b: label });
      else seen.set(key, label);
    });
    return conflicts;
  }

  return {
    MIN_HP: MIN_HP, MAX_HP: MAX_HP, MAX_CANNONS: MAX_CANNONS,
    DEFAULT_DAMAGE: DEFAULT_DAMAGE, CANNON_FIELDS: CANNON_FIELDS,
    PASS_SCORE: PASS_SCORE, isPerfect: isPerfect,
    readHp: readHp, readAmmo: readAmmo, clampDamage: clampDamage,
    applyDamage: applyDamage, effectiveScore: effectiveScore, finalScore: finalScore,
    isInBattle: isInBattle, hasClaimed: hasClaimed, claimBullet: claimBullet,
    summarizeIncoming: summarizeIncoming, stripCannonFields: stripCannonFields,
    findByPassword: findByPassword, passwordConflicts: passwordConflicts
  };
});
