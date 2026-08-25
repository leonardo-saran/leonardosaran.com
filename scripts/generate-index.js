#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SECTIONS = ['archive', 'portfolio'];
// Content root anchored to THIS file's location, never process.cwd(): the
// script must produce identical output regardless of the working directory
// it is invoked from (same contract as generate-site.js PROJECT_ROOT).
const CONTENT_ROOT = path.join(__dirname, '..', 'src', 'content');

function listSubdirectories(parent) {
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

const CONTENT_FILE_PATTERN = /^index(\.[a-z]{2,3})?\.md$/;

// Slug patterns - three regexes with a deliberate relationship:
// 1. Runtime loadPost (app.js, post detail):
//    /^[a-zA-Z0-9]+(\/[a-zA-Z0-9\-]+)*$/: full date-prefixed path slug
//    ("2026/07/29/my-slug"); alphanumeric segments separated by single
//    slashes, leading/trailing/consecutive slashes rejected.
// 2. Runtime listing guard (loadItemMetadata, same regex): validation-at-use
//    for every slug fetched from index.json before any fetch.
// 3. Leaf-slug pattern below: MORE RESTRICTIVE BY DESIGN: the generator
//    walks the yyyy/mm/dd hierarchy itself, so it validates only the final
//    segment: alphanumeric start, then alnum/dash, no slashes.
const SLUG_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-]*$/;

function isContentFolder(absolutePath) {
  try {
    const files = fs.readdirSync(absolutePath);
    return files.some((file) => CONTENT_FILE_PATTERN.test(file));
  } catch (err) {
    return false;
  }
}

function collectSlugs(sectionRoot) {
  if (!fs.existsSync(sectionRoot)) return [];

  const slugs = [];

  for (const year of listSubdirectories(sectionRoot).filter((n) => /^\d{4}$/.test(n))) {
    const yearPath = path.join(sectionRoot, year);
    for (const month of listSubdirectories(yearPath).filter((n) => /^\d{2}$/.test(n))) {
      const monthPath = path.join(yearPath, month);
      for (const day of listSubdirectories(monthPath).filter((n) => /^\d{2}$/.test(n))) {
        const dayPath = path.join(monthPath, day);
        for (const slug of listSubdirectories(dayPath)) {
          if (SLUG_NAME_PATTERN.test(slug) && isContentFolder(path.join(dayPath, slug))) {
            slugs.push(path.posix.join(year, month, day, slug));
          }
        }
      }
    }
  }

  slugs.sort();
  slugs.reverse();
  return slugs;
}

function writeIndex(sectionRoot, slugs) {
  const indexPath = path.join(sectionRoot, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(slugs, null, 2) + '\n', 'utf8');
}

function main() {
  try {
    for (const section of SECTIONS) {
      const sectionRoot = path.join(CONTENT_ROOT, section);
      writeIndex(sectionRoot, collectSlugs(sectionRoot));
    }
  } catch (err) {
    // err.message embeds absolute paths; print only the code
    // (e.g. EACCES) with a static fallback when code is absent.
    process.stderr.write(`generate-index: ${err.code || 'unexpected error'}\n`);
    process.exit(1);
  }
}

// Run as CLI only when executed directly (never on import by tests).
if (require.main === module) {
  main();
}
