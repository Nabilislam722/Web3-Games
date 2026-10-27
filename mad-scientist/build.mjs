// Copy the files the game needs into dist/, which wrangler publishes.
// Only what is listed here is ever uploaded: contracts/ (with its .env)
// never is.
import { cpSync, rmSync } from 'node:fs';

const SITE = ['index.html', 'viewer.html', 'style.css', 'js', 'assets'];
const root = new URL('./', import.meta.url);
const dist = new URL('dist/', root);

rmSync(dist, { recursive: true, force: true });
for (const path of SITE) cpSync(new URL(path, root), new URL(path, dist), { recursive: true });
console.log(`Copied ${SITE.join(', ')} to dist/`);
