/**
 * Unit tests for jarsRepo — op-sqlite migration v6 (head) + CRUD + balance.
 *
 * Pattern: node:test + assert (mirrors donutArcs.test.ts / filterCompose.test.ts).
 * Run via: npx tsx --test src/features/jars/jarsRepo.test.ts
 *
 * NOTE: jest harness is not set up in apps/mobile (see STATE.md [[jest-harness-missing]]).
 * This file must typecheck and lint but cannot be run in CI until the jest task is done.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runMigrations, getSchemaVersion } from '@/src/lib/db';
import { openTestDB } from '@/src/lib/db/testDb';
import {
  createJar,
  listJars,
  getJar,
  jarBalanceCents,
  insertContribution,
} from './jarsRepo.js';

// ---------------------------------------------------------------------------
// Helper — fresh isolated DB for each test
// ---------------------------------------------------------------------------

function freshDB() {
  const db = openTestDB(`:memory:`);
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Migration gate: schema version === 6 after runMigrations
// ---------------------------------------------------------------------------

test('getSchemaVersion === 6 after runMigrations on a fresh DB', () => {
  const db = freshDB();
  assert.strictEqual(getSchemaVersion(db), 6);
});

// ---------------------------------------------------------------------------
// createJar + getJar round-trip
// ---------------------------------------------------------------------------

test('createJar returns a numeric id; getJar retrieves the same row', () => {
  const db = freshDB();
  const id = createJar(
    { name: 'Holiday', targetCents: 100000, icon: 'jar-plane', ruleJson: '{"kind":"roundup","unitCents":100}' },
    db,
  );
  assert.ok(typeof id === 'number' && id > 0, 'id must be a positive number');

  const jar = getJar(id, db);
  assert.ok(jar !== null, 'getJar must return a row');
  assert.strictEqual(jar.name, 'Holiday');
  assert.strictEqual(jar.targetCents, 100000);
  assert.strictEqual(jar.icon, 'jar-plane');
  assert.strictEqual(jar.ruleJson, '{"kind":"roundup","unitCents":100}');
});

// ---------------------------------------------------------------------------
// listJars returns inserted jar
// ---------------------------------------------------------------------------

test('listJars returns all inserted jars', () => {
  const db = freshDB();
  createJar({ name: 'Alpha', targetCents: 50000, icon: 'jar-piggy', ruleJson: '{"kind":"roundup","unitCents":100}' }, db);
  createJar({ name: 'Beta',  targetCents: 20000, icon: 'jar-star',  ruleJson: '{"kind":"roundup","unitCents":500}' }, db);

  const jars = listJars(db);
  assert.strictEqual(jars.length, 2);
  // listJars is ordered by created_at DESC — both inserted immediately, order may vary; just check names
  const names = jars.map((j) => j.name);
  assert.ok(names.includes('Alpha'), 'Alpha must be in list');
  assert.ok(names.includes('Beta'),  'Beta must be in list');
});

// ---------------------------------------------------------------------------
// jarBalanceCents === 0 when no contributions
// ---------------------------------------------------------------------------

test('jarBalanceCents returns 0 when no contributions exist', () => {
  const db = freshDB();
  const id = createJar({ name: 'Empty', targetCents: 10000, icon: 'jar-star', ruleJson: '{"kind":"roundup","unitCents":100}' }, db);
  assert.strictEqual(jarBalanceCents(id, db), 0);
});

// ---------------------------------------------------------------------------
// insertContribution increments jarBalanceCents
// ---------------------------------------------------------------------------

test('insertContribution: jarBalanceCents reflects sum of contributions', () => {
  const db = freshDB();
  const now = Math.floor(Date.now() / 1000);
  const id = createJar({ name: 'Rainy Day', targetCents: 50000, icon: 'jar-cloud', ruleJson: '{"kind":"roundup","unitCents":100}' }, db);

  insertContribution({ jarId: id, amountCents: 500, source: 'roundup', txId: null, createdAt: now }, db);
  assert.strictEqual(jarBalanceCents(id, db), 500);

  insertContribution({ jarId: id, amountCents: 250, source: 'manual', txId: null, createdAt: now }, db);
  assert.strictEqual(jarBalanceCents(id, db), 750);
});

// ---------------------------------------------------------------------------
// runMigrations idempotency: re-running on already-v6 DB does not throw
// ---------------------------------------------------------------------------

test('runMigrations is idempotent on an already-migrated DB', () => {
  const db = freshDB();
  assert.strictEqual(getSchemaVersion(db), 6);
  // Must not throw
  assert.doesNotThrow(() => runMigrations(db));
  assert.strictEqual(getSchemaVersion(db), 6);
});

// ---------------------------------------------------------------------------
// getJar returns null for unknown id
// ---------------------------------------------------------------------------

test('getJar returns null for an id that does not exist', () => {
  const db = freshDB();
  assert.strictEqual(getJar(9999, db), null);
});
