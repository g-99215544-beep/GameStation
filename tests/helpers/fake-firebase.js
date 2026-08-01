// Installed with page.addInitScript(fn, seed) so it runs before index.html's
// script tag. Mirrors just enough of firebase-database-compat for the app:
// ref(), once(), on(), off(), update(), set(), push(), remove(), transaction().
//
// Modeled on the working shims already proven in tests/station-count.spec.js,
// tests/group-management.spec.js, and tests/hunts.spec.js (structuredClone-based
// store, synchronous on() callbacks, apps/initializeApp bookkeeping), but keeps
// window.__db exposed as the raw mutable store so specs can assert against it
// directly instead of round-tripping through db.ref(...).once('value').
module.exports = function installFakeFirebase(seed) {
  const db = JSON.parse(JSON.stringify(seed));
  window.__db = db;
  const listeners = [];

  const split = p => String(p).split('/').filter(Boolean);
  const read = parts => parts.reduce((node, key) => (node == null ? node : node[key]), db);
  const write = (parts, value) => {
    let node = db;
    parts.slice(0, -1).forEach(key => {
      if (node[key] == null || typeof node[key] !== 'object') node[key] = {};
      node = node[key];
    });
    const last = parts[parts.length - 1];
    if (last === undefined) return;
    if (value === null) delete node[last]; else node[last] = value;
  };
  // Real Firebase only calls a `.value` listener when data at (or under, or
  // above) its own path actually changed — a write to progress/2/hp never
  // reaches a listener on activeHuntId. Scope notifications the same way, or
  // an unrelated write anywhere in the tree spuriously re-fires every listener
  // in the app (e.g. re-triggering the login-screen redirect mid-session).
  const related = (a, b) => {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  const notify = changedParts => listeners.forEach(l => {
    if (changedParts && !related(l.parts, changedParts)) return;
    l.cb(snapshot(read(l.parts)));
  });
  const snapshot = value => ({
    val: () => (value === undefined ? null : value),
    exists: () => value !== undefined && value !== null
  });

  let pushCounter = 0;
  function ref(path) {
    const parts = split(path);
    const api = {
      key: parts[parts.length - 1] || null,
      child: sub => ref(parts.concat(split(sub)).join('/')),
      once: () => Promise.resolve(snapshot(read(parts))),
      on: (event, cb) => { listeners.push({ parts, cb }); cb(snapshot(read(parts))); return cb; },
      off: () => {
        for (let i = listeners.length - 1; i >= 0; i--) {
          if (listeners[i].parts.join('/') === parts.join('/')) listeners.splice(i, 1);
        }
      },
      set: value => { write(parts, value); notify(parts); return Promise.resolve(); },
      // Real Firebase treats a key set to null in an update() as a delete of
      // that child, and — since it never stores empty container objects —
      // removes the parent entirely once its last child is gone. Mirror both:
      // merge non-null keys in, drop null-valued keys instead of storing the
      // literal null, and prune the node if nothing is left.
      update: value => {
        const current = read(parts) || {};
        const merged = Object.assign({}, current);
        Object.keys(value || {}).forEach(key => {
          if (value[key] === null) delete merged[key]; else merged[key] = value[key];
        });
        write(parts, Object.keys(merged).length ? merged : null);
        notify(parts);
        return Promise.resolve();
      },
      remove: () => { write(parts, null); notify(parts); return Promise.resolve(); },
      push: value => {
        const id = 'k' + (++pushCounter);
        if (value !== undefined) { write(parts.concat(id), value); notify(parts.concat(id)); }
        const child = ref(parts.concat(id).join('/'));
        return Object.assign(Promise.resolve(child), child);
      },
      transaction: fn => {
        const next = fn(read(parts));
        if (next === undefined) {
          return Promise.resolve({ committed: false, snapshot: snapshot(read(parts)) });
        }
        write(parts, next);
        notify(parts);
        return Promise.resolve({ committed: true, snapshot: snapshot(next) });
      }
    };
    return api;
  }

  window.firebase = {
    apps: [],
    initializeApp: () => { window.firebase.apps.push({}); },
    database: () => ({
      ref: path => (path === '.info/connected'
        ? { on: (_e, cb) => cb(snapshot(true)), off: () => {} }
        : ref(path))
    })
  };
};
