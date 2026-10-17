#!/usr/bin/env node
/**
 * @module scripts/apply-r2-cors
 *
 * Applies the permissive CORS policy in config/r2-cors.json to Cloudflare R2 bucket.
 * Bucket defaults to 'sunshade-assets' or $R2_BUCKET.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const CORS_FILE = path.resolve(REPO_ROOT, 'config/r2-cors.json');

const BUCKET = process.env.R2_BUCKET || 'sunshade-assets';

console.log(`⚡ Applying Cloudflare R2 CORS policy to bucket '${BUCKET}' from ${CORS_FILE}...`);

if (!fs.existsSync(CORS_FILE)) {
  console.error(`❌ CORS file not found: ${CORS_FILE}`);
  process.exit(1);
}

try {
  const cmd = `npx wrangler r2 bucket cors set "${BUCKET}" --file "${CORS_FILE}" --force`;
  execSync(cmd, { stdio: 'inherit', cwd: REPO_ROOT });
  console.log('✅ CORS configuration successfully applied.');
} catch (err) {
  console.warn(`⚠️ Could not apply remote R2 CORS via Wrangler directly: ${err.message}`);
  console.warn('Ensure CLOUDFLARE_API_TOKEN is exported or apply manually via Cloudflare dashboard.');
}
