import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const pluginDir = join(process.cwd(), '.obsidian/plugins/sageum-semantic');

test('sageum semantic obsidian plugin files expose the required phase 8 surface', () => {
  const manifestPath = join(pluginDir, 'manifest.json');
  const mainPath = join(pluginDir, 'main.js');
  const stylesPath = join(pluginDir, 'styles.css');
  const communityPluginsPath = join(process.cwd(), '.obsidian/community-plugins.json');

  assert.ok(existsSync(manifestPath), 'manifest.json should exist');
  assert.ok(existsSync(mainPath), 'main.js should exist');
  assert.ok(existsSync(stylesPath), 'styles.css should exist');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.id, 'sageum-semantic');
  assert.equal(manifest.name, 'Sageum Semantic');
  assert.equal(manifest.isDesktopOnly, false);

  const main = readFileSync(mainPath, 'utf8');
  assert.match(main, /SAGEUM_SEMANTIC_VIEW_TYPE/);
  assert.match(main, /registerView/);
  assert.match(main, /requestUrl/);
  assert.match(main, /vault\/index/);
  assert.match(main, /\.sageum\/index\.sqlite/);
  assert.match(main, /createConceptFromSelection/);
  assert.match(main, /createRelationFromSelection/);
  assert.match(main, /\.sageum\/relations/);

  const communityPlugins = JSON.parse(readFileSync(communityPluginsPath, 'utf8'));
  assert.ok(communityPlugins.includes('sageum-semantic'), 'plugin should be registered in community-plugins.json');
});
