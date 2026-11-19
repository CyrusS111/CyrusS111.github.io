// Encrypted vault, synced through a private GitHub repository.
//
// - All business data is CSV text, encrypted with AES-256-GCM by a random data key.
// - Each user's password (PBKDF2-SHA256) wraps that data key; the wrapped keys live in the same file.
// - GitHub holds the master copy (data/elsys.vault). Each device keeps an encrypted offline copy.
// - Signing in normally needs GitHub: the password must open the copy downloaded from GitHub.
//   Offline sign-in uses the device copy, and is only allowed for OFFLINE_DAYS after the last GitHub check.
// - Every change is saved on the device at once and uploaded in the background. If another device saved
//   in between, the two versions are merged (see Store.merge) before uploading.
'use strict';

const Vault = (() => {
  const ITER = 310000, OFFLINE_DAYS = 7, DATA_PATH = 'data/elsys.vault';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const nowIso = () => new Date().toISOString();

  // ---------- IndexedDB key/value store (one shared connection) ----------
  const DB = 'elsys-invoicing', STORE = 'kv';
  let conn = null;
  function idb() {
    if (conn) return conn;
    conn = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); conn = null; };
        db.onclose = () => { conn = null; };
        res(db);
      };
      r.onerror = () => { conn = null; rej(r.error); };
    });
    return conn;
  }
  async function kvGet(k) {
    const db = await idb();
    return new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function kvSet(k, v) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }

  // ---------- crypto ----------
  async function pbkdf2(password, salt, iter, alg, usages) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: alg, length: 256 }, false, usages);
  }
  async function wrapFor(username, password, dataKey, admin) {
    const salt = rand(16);
    const k = await pbkdf2(password, salt, ITER, 'AES-KW', ['wrapKey']);
    return { u: username.toLowerCase(), name: username, salt: b64(salt), iter: ITER, key: b64(await crypto.subtle.wrapKey('raw', dataKey, k, 'AES-KW')), admin: !!admin };
  }
  async function unwrap(entry, password) {
    const k = await pbkdf2(password, unb64(entry.salt), entry.iter, 'AES-KW', ['unwrapKey']);
    return crypto.subtle.unwrapKey('raw', unb64(entry.key), k, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function sealWith(key, obj) {
    const iv = rand(12);
    return { iv: b64(iv), data: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)))) };
  }
  async function openWith(key, sealed) {
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, key, unb64(sealed.data))));
  }
  // The GitHub token is stored on the device locked with the user's password.
  async function sealToken(password, token) {
    const salt = rand(16);
    const k = await pbkdf2(password, salt, ITER, 'AES-GCM', ['encrypt']);
    return { salt: b64(salt), ...(await sealWith(k, token)) };
  }
  async function openToken(password, sealed) {
    const k = await pbkdf2(password, unb64(sealed.salt), ITER, 'AES-GCM', ['decrypt']);
    return openWith(k, sealed);
  }

  // ---------- session state ----------
  let device = null;      // { owner, repo, tokens: {user: sealedToken}, lastOnline: {user: iso} }
  let file = null;        // { v, app, users, iv, data, savedAt }  (same shape locally and on GitHub)
  let dataKey = null, user = null, password = null, token = null;
  let sync = { baseSha: null, dirty: false };   // sha of the GitHub version our copy is based on
  let version = 0;                               // bumps on every local save
  let online = false, pushTimer = null, pushing = null, lastSync = null, lastError = '';
  let pendingUserOps = [];                       // user changes to re-apply if GitHub changed meanwhile
  const hooks = { merge: null, status: () => {}, kicked: () => {} };

  function setStatus(state, message) {
    if (state === 'error') lastError = message || '';
    hooks.status({ state, message, pending: sync.dirty, lastSync, online });
  }
  const parse = bytes => JSON.parse(dec.decode(bytes));
  const fileBytes = () => enc.encode(JSON.stringify({ v: file.v, app: file.app, users: file.users, iv: file.iv, data: file.data, savedAt: file.savedAt }));
  async function markOnline() {
    online = true; lastSync = new Date();
    device.lastOnline[user.u] = nowIso();
    await kvSet('device', device);
  }
  function needToken(msg) { const e = new Error(msg); e.needToken = true; return e; }

  // Apply a version downloaded from GitHub. If we have unsent changes, merge; otherwise replace.
  async function adoptRemote(remote) {
    const rf = parse(remote.bytes);
    const me = rf.users.find(x => x.u === user.u);
    if (!me) { hooks.kicked('Your user was removed on another device.'); return false; }
    const remoteFiles = await openWith(dataKey, rf);
    file.users = rf.users;
    for (const op of pendingUserOps) await op();
    user = file.users.find(x => x.u === user.u) || me;
    const merged = hooks.merge(remoteFiles, sync.dirty ? 'merge' : 'replace');
    Object.assign(file, await sealWith(dataKey, merged), { savedAt: nowIso() });
    sync.baseSha = remote.sha;
    await kvSet('vault', file); await kvSet('sync', sync);
    return true;
  }

  async function push() {
    if (!dataKey) return;
    if (pushing) { await pushing; if (!sync.dirty) return; }
    pushing = (async () => {
      for (let attempt = 0; attempt < 5 && sync.dirty; attempt++) {
        const startVersion = version;
        setStatus('saving');
        try {
          sync.baseSha = await GitHub.write(DATA_PATH, fileBytes(), sync.baseSha, `Update by ${user.name}`);
          if (version === startVersion) { sync.dirty = false; pendingUserOps = []; }
          await kvSet('sync', sync); await markOnline();
          setStatus('synced');
        } catch (e) {
          if (e.conflict) {
            const remote = await GitHub.read(DATA_PATH).catch(err => { if (err.offline) return 'offline'; throw err; });
            if (remote === 'offline') { online = false; setStatus('offline'); return; }
            if (remote && !(await adoptRemote(remote))) return;
            if (!remote) sync.baseSha = null;
            continue;
          }
          if (e.offline) { online = false; setStatus('offline'); return; }
          setStatus('error', e.message); return;
        }
      }
    })();
    try { await pushing; } finally { pushing = null; }
  }
  function schedulePush(delay = 1500) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push().catch(e => setStatus('error', e.message)), delay);
  }

  return {
    OFFLINE_DAYS,
    onMerge(fn) { hooks.merge = fn; },
    onStatus(fn) { hooks.status = fn; },
    onKicked(fn) { hooks.kicked = fn; },
    get user() { return user; },
    get users() { return file ? file.users.map(x => ({ name: x.name, admin: !!x.admin })) : []; },
    get online() { return online; },
    get device() { return device; },
    get lastError() { return lastError; },

    async loadDevice() { device = (await kvGet('device')) || null; return device; },
    // Step 1 on a new device: check the repository and remember it. Returns whether a data file already exists.
    async connect(owner, repo, tok) {
      GitHub.configure({ owner: owner.trim(), repo: repo.trim(), token: tok.trim() });
      await GitHub.checkRepo();
      const remote = await GitHub.read(DATA_PATH);
      const old = (await kvGet('device')) || {};
      const sameRepo = old.owner === owner.trim() && old.repo === repo.trim();
      device = { owner: owner.trim(), repo: repo.trim(), tokens: sameRepo ? old.tokens || {} : {}, lastOnline: sameRepo ? old.lastOnline || {} : {} };
      if (!sameRepo) { await kvSet('vault', null); await kvSet('sync', { baseSha: null, dirty: false }); }
      await kvSet('device', device);
      token = tok.trim();
      return { exists: !!remote };
    },
    // First user ever: create the data file on GitHub.
    async create(username, pw, files) {
      if (!token) throw needToken('Enter the access key.');
      if (await GitHub.read(DATA_PATH)) throw new Error('This data store already has data. Sign in instead.');
      dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      user = await wrapFor(username.trim(), pw, dataKey, true);
      file = { v: 2, app: 'elsys-invoicing', users: [user], ...(await sealWith(dataKey, files)), savedAt: nowIso() };
      sync = { baseSha: null, dirty: false };
      sync.baseSha = await GitHub.write(DATA_PATH, fileBytes(), null, `Create data file (${user.name})`);
      await kvSet('vault', file); await kvSet('sync', sync);
      device.tokens[user.u] = await sealToken(pw, token);
      password = pw; await markOnline();
      setStatus('synced');
    },
    // Sign in. Returns { files, online, unsent } where unsent = this device's changes not yet on GitHub.
    async login(username, pw, tokenInput) {
      if (!device) throw new Error('This device is not connected to cloud storage yet.');
      const u = username.trim().toLowerCase();
      const fromConnect = token;   // just typed on the Connect screen
      token = tokenInput ? tokenInput.trim()
        : device.tokens[u] ? await openToken(pw, device.tokens[u]).catch(() => fromConnect)
        : fromConnect;
      if (!token) throw needToken(device.tokens[u]
        ? 'Wrong password. (If your password was changed on another device, also enter the access key.)'
        : 'First sign-in for this user on this device: enter the access key as well.');
      GitHub.configure({ owner: device.owner, repo: device.repo, token });
      const local = await kvGet('vault');
      sync = (await kvGet('sync')) || { baseSha: null, dirty: false };

      let remote = null, offline = false;
      try { remote = await GitHub.read(DATA_PATH); }
      catch (e) { if (e.offline) offline = true; else { if (e.status === 401) throw needToken(e.message); throw e; } }

      if (!offline) {
        if (!remote) throw new Error('This data store has no data yet.');
        const rf = parse(remote.bytes);
        const entry = rf.users.find(x => x.u === u);
        if (!entry) throw new Error('Unknown user.');
        dataKey = await unwrap(entry, pw).catch(() => { throw new Error('Wrong password.'); });
        user = entry; password = pw;
        const remoteFiles = await openWith(dataKey, rf);
        let unsent = null;
        if (local && sync.dirty) unsent = await openWith(dataKey, local).catch(() => null);
        file = rf; sync.baseSha = remote.sha;
        await kvSet('vault', file); await kvSet('sync', sync);
        device.tokens[u] = await sealToken(pw, token);
        await markOnline();
        setStatus(unsent ? 'saving' : 'synced');
        return { files: remoteFiles, unsent, online: true };
      }

      // Offline sign-in
      if (!local) throw new Error('No connection to cloud storage, and this device has no saved copy yet. Connect to the internet to sign in.');
      const entry = local.users.find(x => x.u === u);
      if (!entry) throw new Error('Unknown user.');
      dataKey = await unwrap(entry, pw).catch(() => { throw new Error('Wrong password.'); });
      const last = device.lastOnline[u];
      const days = last ? (Date.now() - Date.parse(last)) / 864e5 : Infinity;
      if (days > OFFLINE_DAYS) { dataKey = null; throw new Error(`Offline sign-in is only allowed for ${OFFLINE_DAYS} days after the last online check. Connect to the internet to sign in.`); }
      user = entry; password = pw; file = local; online = false;
      setStatus('offline');
      return { files: await openWith(dataKey, local), unsent: null, online: false };
    },
    logout() { clearTimeout(pushTimer); dataKey = null; file = null; user = null; password = null; token = null; pendingUserOps = []; },

    // Save locally now, upload soon.
    async save(files) {
      version++;
      Object.assign(file, await sealWith(dataKey, files), { savedAt: nowIso() });
      sync.dirty = true;
      await kvSet('vault', file); await kvSet('sync', sync);
      setStatus(online ? 'saving' : 'offline');
      schedulePush();
    },
    // Upload pending changes and download changes from other devices.
    async syncNow() {
      if (!dataKey) return;
      if (sync.dirty) return push();
      try {
        const remote = await GitHub.read(DATA_PATH);
        if (remote && remote.sha !== sync.baseSha && dataKey) { if (!(await adoptRemote(remote))) return; }
        await markOnline(); setStatus('synced');
      } catch (e) {
        if (e.offline) { online = false; setStatus('offline'); } else setStatus('error', e.message);
      }
    },
    flush() { clearTimeout(pushTimer); return push(); },

    // ---- user management (needs GitHub, so everyone sees the same user list) ----
    async userOp(op) {
      if (!online) throw new Error('Connect to the internet to change users or passwords.');
      await op(); pendingUserOps.push(op);
      sync.dirty = true; version++;
      Object.assign(file, { savedAt: nowIso() });
      await kvSet('vault', file); await kvSet('sync', sync);
      await push();
      if (sync.dirty) throw new Error(lastError || 'Could not save to the cloud. Try again when online.');
    },
    addUser(username, pw, admin) {
      return this.userOp(async () => {
        if (file.users.some(x => x.u === username.toLowerCase())) throw new Error('User already exists');
        file.users.push(await wrapFor(username, pw, dataKey, admin));
      });
    },
    removeUser(username) {
      const u = username.toLowerCase();
      return this.userOp(async () => { file.users = file.users.filter(x => x.u !== u); });
    },
    async changePassword(pw) {
      const entry = await wrapFor(user.name, pw, dataKey, user.admin);
      await this.userOp(async () => { file.users = file.users.map(x => x.u === entry.u ? entry : x); });
      user = entry; password = pw;
      device.tokens[user.u] = await sealToken(pw, token); await kvSet('device', device);
    },

    // ---- PDF fonts: kept on the device, shared between devices through the private repository ----
    getFonts: () => kvGet('fonts'),
    setFonts: fonts => kvSet('fonts', fonts),
    async fontFromGitHub(name) {
      if (!GitHub.ready) return null;
      const r = await GitHub.read('fonts/' + name);
      return r ? r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) : null;
    },
    async uploadFonts(fonts) {
      for (const [name, buf] of Object.entries(fonts)) {
        const existing = await GitHub.read('fonts/' + name);
        if (existing) continue;
        await GitHub.write('fonts/' + name, new Uint8Array(buf), null, 'Add PDF font ' + name);
      }
    },

    // ---- extra offline backup file (already encrypted) ----
    exportBlob() { return new Blob([fileBytes()], { type: 'application/octet-stream' }); },
    async readBackup(text, pw) {
      const f = JSON.parse(text);
      if (f.app !== 'elsys-invoicing') throw new Error('Not an EL-SYS backup file');
      try { return await openWith(dataKey, f); } catch { /* made with another data key */ }
      const entry = f.users.find(x => x.u === user.u) || f.users[0];
      const k = await unwrap(entry, pw).catch(() => { throw new Error('Password does not open this backup'); });
      return openWith(k, f);
    },
  };
})();
