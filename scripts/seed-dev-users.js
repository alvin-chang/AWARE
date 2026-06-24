#!/usr/bin/env node
/**
 * scripts/seed-dev-users.js
 * 
 * Generates dev-only user fixtures at install/setup time.
 * These are NOT real users — they're test data for local development.
 * 
 * Usage: node scripts/seed-dev-users.js
 * Output: src/data/users.json (gitignored)
 * 
 * Security: This file is committed because it's the seeder SOURCE.
 * The OUTPUT (src/data/users.json) is gitignored and generated at install.
 * 
 * The hash values are SHA-512 of the literal strings "admin" and "user"
 * with a fixed salt. They are NOT secrets — they're reproducible fixtures
 * so anyone running `npm run seed:dev` gets the same hashes.
 * 
 * See: docs/security/history-rewrites.md for context on why this is the
 * install-time pattern (post-2026-06-23 privacy filter rollout).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIXTURE_SALT = 'fdf2b9326322f1f96ed1f24fc4a4b399fb13dc65b38b9a5bdaf3f94abf0be62b';

function hashPassword(password, salt) {
  return crypto.createHash('sha512')
    .update(password + ':' + salt)
    .digest('hex');
}

const users = [
  {
    id: '3496839d-a1a2-4fde-80f7-e3bc2facb7a8',
    username: 'admin',
    email: 'admin@example.com',
    passwordHash: hashPassword('admin', FIXTURE_SALT),
    salt: FIXTURE_SALT,
    role: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: true,
  },
  {
    id: '0ea28946-3d11-4d8b-9eef-0ed699595cb9',
    username: 'user',
    email: 'user@example.com',
    passwordHash: hashPassword('user', FIXTURE_SALT),
    salt: FIXTURE_SALT,
    role: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: true,
  },
];

const outputPath = path.join(__dirname, '..', 'src', 'data', 'users.json');
fs.writeFileSync(outputPath, JSON.stringify({ users }, null, 2) + '\n');
console.log(`✅ Wrote ${users.length} dev users to ${outputPath}`);
console.log('   These are TEST FIXTURES — never use for production.');
