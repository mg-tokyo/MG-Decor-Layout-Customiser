#!/usr/bin/env node
// scripts/sync-game-assets.mjs — snapshot the live game's decor catalog and
// sprites into assets/. Node >= 20, zero dependencies.
//
//   node scripts/sync-game-assets.mjs           sync (writes files)
//   node scripts/sync-game-assets.mjs --check   dry run; exit 1 if changes pending
//
// Sources:
//   https://magicgarden.gg/                     -> game version + index chunk
//   .../version/<v>/assets/manifest.json        -> 2x atlas JSONs (anchors, sizes)
//   https://mg-api.ariedam.fr/data              -> decor catalog (CORS-open JSON)
//   https://mg-api.ariedam.fr/assets/sprites/decor/<Name>.png -> untrimmed PNGs
//   live index-*.js / main-*.js                 -> edge-snap decor ID list

import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EDGE_SNAP_IDS,
  assertNotShrunk,
  buildCatalog,
  collectDecorFrames,
  extractEdgeSnapIds,
  parseGameVersion,
  readPngSize,
  selectAtlasJsonPaths,
  stripVolatile,
} from './lib/sync-helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'assets', 'decor-catalog.json');
const SPRITES_DIR = path.join(ROOT, 'assets', 'sprites', 'decor');
const GAME_ORIGIN = 'https://magicgarden.gg';
const API_ORIGIN = 'https://mg-api.ariedam.fr';
const CHECK = process.argv.includes('--check');

async function fetchWithRetry(url, { attempts = 3, as = 'text' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      if (as === 'json') return await res.json();
      if (as === 'bytes') return new Uint8Array(await res.arrayBuffer());
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadAtlasFrames(assetBase, paths) {
  const seen = new Set();
  const atlases = {};
  async function loadOne(p) {
    if (seen.has(p)) return;
    seen.add(p);
    const json = await fetchWithRetry(assetBase + p, { as: 'json' });
    atlases[p] = json;
    for (const rel of json?.meta?.related_multi_packs ?? []) {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
      await loadOne(dir + rel);
    }
  }
  for (const p of paths) await loadOne(p);
  return atlases;
}

async function loadPreviousCatalog() {
  try {
    return JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function loadEdgeSnapIds(indexHtml, assetBase, previous, log) {
  try {
    const refsOf = (text) =>
      [...new Set([...text.matchAll(/["'`]([\w./-]+\.js)["'`]/g)].map((m) => m[1]))];
    // The list lives in a deep chunk (index -> bootstrap -> ... -> main-*.js as
    // of v1072), so follow the import graph breadth-first, main-* chunks first.
    const queue = refsOf(indexHtml).map((r) => new URL(r, `${GAME_ORIGIN}/`).href);
    const seen = new Set(queue);
    let fetched = 0;
    while (queue.length > 0 && fetched < 100) {
      queue.sort((a, b) => Number(b.includes('/main-')) - Number(a.includes('/main-')));
      const url = queue.shift();
      let text;
      try {
        text = await fetchWithRetry(url, { attempts: 2 });
      } catch {
        continue;
      }
      fetched += 1;
      const ids = extractEdgeSnapIds(text);
      if (ids) return ids;
      for (const r of refsOf(text)) {
        const abs = new URL(r, assetBase).href;
        if (!seen.has(abs)) {
          seen.add(abs);
          queue.push(abs);
        }
      }
    }
    throw new Error(`edge-snap includes(decorId) pattern not found in ${fetched} chunks`);
  } catch (err) {
    log.push(`edge-snap-fallback: ${err.message}`);
    return previous?.edgeSnapDecorIds ?? DEFAULT_EDGE_SNAP_IDS;
  }
}

async function syncSprites(catalog, log) {
  if (!CHECK) await mkdir(SPRITES_DIR, { recursive: true });
  const wanted = Object.keys(catalog.sprites);
  const changes = { written: [], deleted: [], missing: [] };

  await mapLimit(wanted, 6, async (name) => {
    const sprite = catalog.sprites[name];
    let bytes;
    try {
      bytes = await fetchWithRetry(`${API_ORIGIN}/assets/sprites/decor/${name}.png`, { as: 'bytes' });
    } catch (err) {
      log.push(`missing-png ${name}: ${err.message}`);
      changes.missing.push(name);
      return;
    }
    const size = readPngSize(bytes);
    if (!size) {
      log.push(`bad-png ${name}: not a PNG`);
    } else if (size.w !== sprite.w || size.h !== sprite.h) {
      // Kept anyway: the renderer scales by sourceSize.w / texture.width (spec §5.2.3).
      log.push(`size-mismatch ${name}: png ${size.w}x${size.h} vs atlas ${sprite.w}x${sprite.h}`);
    }
    const file = path.join(SPRITES_DIR, `${name}.png`);
    let same = false;
    try {
      same = Buffer.compare(await readFile(file), Buffer.from(bytes)) === 0;
    } catch {
      same = false;
    }
    if (!same) {
      changes.written.push(name);
      if (!CHECK) await writeFile(file, bytes);
    }
  });

  const existing = existsSync(SPRITES_DIR) ? await readdir(SPRITES_DIR) : [];
  for (const file of existing) {
    if (!file.endsWith('.png')) continue;
    const name = file.slice(0, -4);
    if (!catalog.sprites[name]) {
      changes.deleted.push(name);
      if (!CHECK) await unlink(path.join(SPRITES_DIR, file));
    }
  }
  return changes;
}

async function main() {
  const log = [];

  const html = await fetchWithRetry(`${GAME_ORIGIN}/`);
  const version = parseGameVersion(html);
  if (!version) throw new Error('could not find /version/<v>/assets/ in the game index HTML');
  const assetBase = `${GAME_ORIGIN}/version/${version}/assets/`;

  const manifest = await fetchWithRetry(`${assetBase}manifest.json`, { as: 'json' });
  const atlasPaths = selectAtlasJsonPaths(manifest, 2);
  if (!atlasPaths.length) throw new Error('no 2x sprite atlases found in manifest.json');
  const atlases = await loadAtlasFrames(assetBase, atlasPaths);
  const frames = collectDecorFrames(atlases);
  if (frames.size === 0) throw new Error('no sprite/decor frames found in the 2x atlases');

  const apiData = await fetchWithRetry(`${API_ORIGIN}/data`, { as: 'json' });
  if (!apiData?.decor || typeof apiData.decor !== 'object') {
    throw new Error('mg-api.ariedam.fr/data has no decor map');
  }

  const previous = await loadPreviousCatalog();
  const edgeSnapDecorIds = await loadEdgeSnapIds(html, assetBase, previous, log);

  const { catalog, log: buildLog } = buildCatalog({
    gameVersion: version,
    decorApi: apiData.decor,
    frames,
    edgeSnapDecorIds,
    generatedAt: new Date().toISOString(),
  });
  log.push(...buildLog);

  if (previous && !assertNotShrunk(previous.decor.length, catalog.decor.length)) {
    console.error(
      `ABORT: new catalog has ${catalog.decor.length} decor, previous had ` +
      `${previous.decor.length} (below the 80% safety floor) — refusing to write.`,
    );
    process.exit(1);
  }

  const spriteChanges = await syncSprites(catalog, log);
  const catalogChanged =
    !previous || JSON.stringify(stripVolatile(previous)) !== JSON.stringify(stripVolatile(catalog));
  if (catalogChanged && !CHECK) {
    await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  }

  const prevIds = new Set((previous?.decor ?? []).map((d) => d.decorId));
  const newIds = new Set(catalog.decor.map((d) => d.decorId));
  const added = [...newIds].filter((id) => !prevIds.has(id));
  const removed = [...prevIds].filter((id) => !newIds.has(id));

  const lines = [
    `game version: ${version}`,
    `decor: ${catalog.decor.length} (+${added.length}${added.length ? ` ${added.join(' ')}` : ''} / -${removed.length}${removed.length ? ` ${removed.join(' ')}` : ''})`,
    `sprites: ${Object.keys(catalog.sprites).length} (written ${spriteChanges.written.length}, deleted ${spriteChanges.deleted.length}, missing ${spriteChanges.missing.length})`,
    `catalog changed: ${catalogChanged}`,
    ...log.map((entry) => `note: ${entry}`),
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### Game asset sync\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`,
    );
  }

  if (CHECK && (catalogChanged || spriteChanges.written.length || spriteChanges.deleted.length)) {
    console.error('--check: changes pending');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
