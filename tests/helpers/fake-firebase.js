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
  const notify = () => listeners.forEach(l => l.cb(snapshot(read(l.parts))));
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
      set: value => { write(parts, value); notify(); return Promise.resolve(); },
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
        notify();
        return Promise.resolve();
      },
      remove: () => { write(parts, null); notify(); return Promise.resolve(); },
      push: value => {
        const id = 'k' + (++pushCounter);
        if (value !== undefined) { write(parts.concat(id), value); notify(); }
        const child = ref(parts.concat(id).join('/'));
        return Object.assign(Promise.resolve(child), child);
      },
      transaction: fn => {
        const next = fn(read(parts));
        if (next === undefined) {
          return Promise.resolve({ committed: false, snapshot: snapshot(read(parts)) });
        }
        write(parts, next);
        notify();
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
