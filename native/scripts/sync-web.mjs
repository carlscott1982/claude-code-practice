/* Stages the web app into native/www for Capacitor to bundle.
 *
 * docs/ is the single source of truth — the same files GitHub Pages
 * serves. A few of them have no business inside an APK:
 *   - sw.js: the service worker exists to cache files fetched over the
 *     network. In the APK every asset is already local, so it would be
 *     a cache in front of a cache.
 *   - README.md / make_icons.py: developer files, not app assets.
 *
 * Run: npm run sync
 */

import { cp, rm, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "docs");
const DEST = join(here, "..", "www");

const EXCLUDE = new Set(["sw.js", "README.md", "make_icons.py"]);

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (EXCLUDE.has(entry)) continue;
    const src = join(from, entry);
    const dst = join(to, entry);
    if ((await stat(src)).isDirectory()) await copyTree(src, dst);
    else await cp(src, dst);
  }
}

if (!existsSync(SRC)) {
  console.error("Cannot find docs/ at " + SRC);
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await copyTree(SRC, DEST);

const listed = [];
async function walk(dir) {
  for (const entry of await readdir(dir)) {
    const p = join(dir, entry);
    if ((await stat(p)).isDirectory()) await walk(p);
    else listed.push(relative(DEST, p));
  }
}
await walk(DEST);

console.log("staged " + listed.length + " files into native/www:");
for (const f of listed.sort()) console.log("  " + f);
