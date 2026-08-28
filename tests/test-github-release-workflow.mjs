import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/github-release.yml', 'utf8');

test('GitHub Release workflow is manual-only and accepts a tag input', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tag:/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
});

test('GitHub Release workflow validates canonical stable SemVer tags', () => {
  assert.match(workflow, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(workflow, /git\/ref\/tags/);
  assert.match(workflow, /--verify-tag/);
});

test('GitHub Release workflow rejects existing releases and requires Arcane success', () => {
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /Docker Release & Push to GHCR/);
  assert.match(workflow, /Arcane Deploy/);
  assert.match(workflow, /--status success/);
  assert.match(workflow, /--generate-notes/);
  assert.match(workflow, /--title \"\$RELEASE_TAG\"/);
});

test('GitHub Release workflow does not mutate tags or upload custom assets', () => {
  assert.doesNotMatch(workflow, /git tag/);
  assert.doesNotMatch(workflow, /git push/);
  assert.doesNotMatch(workflow, /--target/);
  assert.doesNotMatch(workflow, /upload|assets/i);
});
