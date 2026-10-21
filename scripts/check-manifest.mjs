// Checks that every file referenced from manifest.json exists, so a broken
// path is caught in CI instead of in chrome://extensions.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'extension';
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const files = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.web_accessible_resources.flatMap((r) => r.resources),
];
const missing = files.filter((f) => !existsSync(join(dir, f)));
if (manifest.manifest_version !== 3) missing.push('manifest_version must be 3');
if (missing.length) {
  console.error('Missing:', missing.join(', '));
  process.exit(1);
}
console.log(`manifest.json ok: ${files.length} referenced files, version ${manifest.version}`);
