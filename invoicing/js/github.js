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
      401: 'GitHub rejected the access token (wrong, expired or revoked).',
      403: 'GitHub refused access. The token needs "Contents: Read and write" on this repository.',
      404: 'Repository not found. Check the username and repository name, and that the token includes this repository.',
    }[r.status] || `GitHub error ${r.status}.`;
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
      const e = new Error('No connection to GitHub.'); e.offline = true; throw e;
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
      if (!j.private) throw new Error('This repository is public. Make it private on GitHub (Settings → General → Danger Zone → Change visibility) and try again.');
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
        const e = new Error('The file changed on GitHub since it was last read.'); e.conflict = true; throw e;
      }
      if (!r.ok) throw httpError(r);
      return (await r.json()).content.sha;
    },
  };
})();
