#!/usr/bin/env node
/**
 * @module scripts/apply-r2-cors
 *
 * Applies the permissive CORS policy in config/r2-cors.json to Cloudflare R2 bucket.
 * Bucket defaults to 'sunshade-assets' or $R2_BUCKET.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const CORS_FILE = path.resolve(REPO_ROOT, 'config/r2-cors.json');

const BUCKET = process.env.R2_BUCKET || 'sunshade-assets';

// Validate bucket name to prevent command injection
if (!/^[a-z0-9._-]+$/i.test(BUCKET)) {
  console.error(`❌ Invalid R2 bucket name: "${BUCKET}". Must contain only alphanumeric, dot, underscore, or dash characters.`);
  process.exit(1);
}

console.log(`⚡ Applying Cloudflare R2 CORS policy to bucket '${BUCKET}' from ${CORS_FILE}...`);

if (!fs.existsSync(CORS_FILE)) {
  console.error(`❌ CORS file not found: ${CORS_FILE}`);
  process.exit(1);
}

try {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(
    npxCmd,
    ['wrangler', 'r2', 'bucket', 'cors', 'set', BUCKET, '--file', CORS_FILE, '--force'],
    { stdio: 'inherit', cwd: REPO_ROOT }
  );
  console.log('✅ CORS configuration successfully applied.');
} catch (err) {
  console.error(`❌ Could not apply remote R2 CORS via Wrangler directly: ${err.message}`);
  process.exit(1);
}
