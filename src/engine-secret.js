// src/engine-secret.js
//
// SEC-001 : the AWAREEngine
// constructor previously failed open with `|| 'default_secret'`, allowing
// a fresh deployment with no env vars to run with a publicly-known JWT
// signing key. This module extracts the fail-closed validation so it can
// be unit-tested without the rest of the AWAREEngine module-load chain
// (which has a pre-existing circular require with src/election).
//
// API:
//   resolveSecretKey({ configSecretKey, envSecretKey, minLength=32 })
//     → string  (the resolved secret)
//     → throws Error with the SEC-001 message if missing or short
//
// Kept in a separate module so:
//   1. The validation rule has one canonical home (no drift).
//   2. Unit tests can exercise it without pulling in src/index.js (which
//      has a circular dep that breaks module-load in test contexts).
//   3. The AWAREEngine constructor and any future secret consumers share
//      the exact same length + presence check.

'use strict';

const DEFAULT_MIN_LENGTH = 32;

function resolveSecretKey(opts) {
  const configSecretKey = opts && opts.configSecretKey;
  const envSecretKey = opts && opts.envSecretKey;
  const minLength = (opts && opts.minLength) || DEFAULT_MIN_LENGTH;

  const supplied = configSecretKey || envSecretKey;
  if (!supplied || typeof supplied !== 'string') {
    throw new Error(
      'AWAREEngine: SECRET_KEY is required (set config.secretKey or process.env.SECRET_KEY). ' +
      'SEC-001  — no default value allowed.'
    );
  }
  if (supplied.length < minLength) {
    throw new Error(
      'AWAREEngine: SECRET_KEY must be at least ' + minLength + ' characters (got ' +
      supplied.length + '). SEC-001 .'
    );
  }
  return supplied;
}

module.exports = { resolveSecretKey, DEFAULT_MIN_LENGTH };
