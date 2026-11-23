import { lazy } from 'react';

const RELOAD_KEY = 'bc_admin_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 15_000;

export function isChunkLoadError(err) {
  const msg = String(err?.message || err || '');
  return (
    err?.name === 'ChunkLoadError' ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk')
  );
}

export function triggerSingleChunkReload() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    const now = Date.now();
    if (now - last > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function lazyWithRetry(importer) {
  return lazy(() =>
    importer().catch((err) => {
      if (isChunkLoadError(err) && triggerSingleChunkReload()) {
        return new Promise(() => {});
      }
      throw err;
    })
  );
}
