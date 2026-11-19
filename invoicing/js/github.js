// Minimal GitHub "contents" API client: read and write single files in one private repository.
'use strict';

const GitHub = (() => {
  const API = 'https://api.github.com';
  let cfg = null;   // { owner, repo, token }

  const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = s => Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0));
  const repoUrl = () => `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const fileUrl = p => repoUrl() + '/contents/' + p.split('/').map(encodeURIComponent).join('/');

  function httpError(r) {
    const msg = {
      401: 'Cloud storage rejected the access key (wrong, expired or revoked).',
      403: 'Access refused. The access key needs read and write permission for this data store.',
      404: 'Data store not found. Check the account ID and data store name, and that the access key includes it.',
    }[r.status] || `Cloud storage error ${r.status}.`;
    const e = new Error(msg); e.status = r.status; return e;
  }
  async function call(url, opts = {}, timeout = 20000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      return await fetch(url, {
        ...opts, cache: 'no-store', signal: ctl.signal,
        headers: { Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
      });
    } catch {
      const e = new Error('No connection to cloud storage.'); e.offline = true; throw e;
    } finally { clearTimeout(t); }
  }

  return {
    configure(c) { cfg = c; },
    get ready() { return !!(cfg && cfg.token && cfg.owner && cfg.repo); },
    // Confirms the token works and the repository is private.
    async checkRepo() {
      const r = await call(repoUrl());
      if (!r.ok) throw httpError(r);
      const j = await r.json();
      if (!j.private) throw new Error('This data store is public. Make it private and try again.');
      return j;
    },
    // Returns { sha, bytes } or null when the file does not exist yet.
    async read(path) {
      const r = await call(fileUrl(path));
      if (r.status === 404) return null;
      if (!r.ok) throw httpError(r);
      const j = await r.json();
      if (j.encoding === 'base64' && j.content) return { sha: j.sha, bytes: fromB64(j.content) };
      const raw = await call(fileUrl(path), { headers: { Accept: 'application/vnd.github.raw+json' } }, 60000);   // files over 1 MB
      if (!raw.ok) throw httpError(raw);
      return { sha: j.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
    },
    // Writes the file. Pass the sha of the version you started from; a mismatch throws { conflict: true }.
    async write(path, bytes, sha, message) {
      const r = await call(fileUrl(path), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: toB64(bytes), ...(sha ? { sha } : {}) }),
      }, 90000);
      if (r.status === 409 || (r.status === 422 && sha) || (r.status === 422 && !sha)) {
        const e = new Error('The data changed in the cloud since it was last read.'); e.conflict = true; throw e;
      }
      if (!r.ok) throw httpError(r);
      return (await r.json()).content.sha;
    },
  };
})();
