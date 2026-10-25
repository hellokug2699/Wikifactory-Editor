#!/usr/bin/env node
/**
 * Single source for owner / repository / issue URL.
 *
 * Everything that needs "whose repo is this" reads it from editor-config.json,
 * so migrating the Content or Editor repository only means editing that JSON
 * (and re-running `npm run config:sync` + `npm run version:sync`). Build scripts
 * must import this module instead of hard-coding an owner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(ROOT, 'editor-config.json');

export function readConfig(file = CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Flattened repository information used by the build scripts. */
export function repoInfo(config = readConfig()) {
  const content = config.content || {};
  const editor = config.editor || {};
  return {
    contentOwner: content.owner,
    contentRepo: content.repo,
    contentBranch: content.branch || '',
    editorOwner: editor.owner,
    editorRepo: editor.repo,
    issueUrl:
      editor.issueUrl || `https://github.com/${editor.owner}/${editor.repo}/issues/new?template=new-page-tag.yml`,
  };
}

export const REPO = repoInfo();

export function githubUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}`;
}

/** Release asset URL, e.g. the updater's `resources.neu`. */
export function releaseAssetUrl(version, asset, info = REPO) {
  return `${githubUrl(info.editorOwner, info.editorRepo)}/releases/download/v${version}/${asset}`;
}

/**
 * Owners allowed to host the repositories. The explicit `allowedOwners` array
 * lets a migration pre-authorise the new org before the switch; otherwise the
 * owners in `content` / `editor` are used.
 */
export function ownerAllowlist(config = readConfig()) {
  const owners = new Set();
  if (Array.isArray(config.allowedOwners)) {
    for (const owner of config.allowedOwners) owners.add(String(owner));
  }
  if (config.content?.owner) owners.add(config.content.owner);
  if (config.editor?.owner) owners.add(config.editor.owner);
  return [...owners].sort();
}
