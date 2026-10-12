#!/usr/bin/env node
// gen-third-party-notices.mjs — build THIRD-PARTY-NOTICES.txt for a release bundle.
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 阿杰很厉害 <506907958@qq.com>
//
// Why this exists: every published archive is a GPL/Apache combined work that
// also statically links third-party libraries, and GPLv3 as well as the
// MIT/BSD-style licenses of those libraries require the copyright notice and
// license text to travel with the copy.  A hand-maintained list of that always
// drifts, so it is generated from two machine-readable sources:
//
//   licenses/manifest.json              native components (curated, hash-checked)
//   `pnpm licenses list --json --prod`  bundled JS packages (lockfile ground truth)
//
// Usage:
//   node scripts/gen-third-party-notices.mjs --out <file> \
//     [--platform win|linux|macos|webui|all] [--pnpm-json <file>] \
//     [--resolved-versions <file.json>]
//
// Dependency-free (node builtins) and deterministic: identical inputs produce
// byte-identical output.  Exits non-zero when the manifest and the files it
// references disagree, so CI catches license-text drift instead of shipping it.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const LICENSE_DIR = path.join(ROOT, 'licenses');
const INLINE_LIMIT = 4096; // longer texts ship as LICENSES/<file> and are referenced

const PLATFORMS = ['win', 'linux', 'macos', 'webui', 'all'];

function fail(message) {
  console.error(`gen-third-party-notices: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    platform: 'all',
    out: '',
    pnpmJson: '',
    resolvedVersions: '',
    manifest: path.join(LICENSE_DIR, 'manifest.json'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    // Valueless flag: consume exactly one token.
    if (flag === '--list-license-files') {
      args.listLicenseFiles = true;
      i -= 1;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) fail(`missing value for ${flag}`);
    switch (flag) {
      case '--platform':
        if (!PLATFORMS.includes(value)) fail(`unknown --platform ${value}`);
        args.platform = value;
        break;
      case '--out':
        args.out = value;
        break;
      case '--pnpm-json':
        args.pnpmJson = value;
        break;
      case '--resolved-versions':
        args.resolvedVersions = value;
        break;
      case '--manifest':
        args.manifest = value;
        break;
      default:
        fail(`unknown argument ${flag}`);
    }
  }
  if (!args.out && !args.listLicenseFiles) fail('--out is required');
  return args;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Read a vendored license text and assert it still matches the manifest hash. */
function readLicenseFile(name, manifest) {
  const entry = manifest.licenseFiles[name];
  if (!entry) fail(`manifest has no licenseFiles entry for ${name}`);
  let buf;
  try {
    buf = fs.readFileSync(path.join(LICENSE_DIR, name));
  } catch {
    fail(`license text ${name} is referenced by the manifest but missing on disk`);
  }
  const digest = sha256(buf);
  if (digest !== entry.sha256) {
    fail(
      `license text drifted: ${name} is ${digest} on disk but ${entry.sha256} in the manifest`,
    );
  }
  return {
    name,
    text: buf.toString('utf8').replace(/\s+$/, ''),
    bytes: buf.length,
    sha256: digest,
  };
}

/** Rewrap prose to the bundle's 76-column layout, preserving paragraphs. */
function wrap(text, width = 76) {
  const out = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (line && `${line} ${word}`.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

const indent = (text, pad) => text.replace(/^/gm, pad);

function rule(title, char = '=') {
  const line = char.repeat(76);
  return `${line}\n${title.toUpperCase()}\n${line}`;
}

function renderOwn(entry, manifest) {
  const parts = [`- ${entry.name}`, `  License : ${entry.spdx}`];
  parts.push('', indent(wrap(entry.statement), '    '));
  for (const file of entry.licenseFiles) {
    const lic = readLicenseFile(file, manifest);
    parts.push(`  Text    : LICENSES/${file} (${lic.bytes} bytes, sha256 ${lic.sha256})`);
  }
  return parts.join('\n');
}

function renderComponent(comp, manifest) {
  const parts = [`- ${comp.name}`];
  parts.push(`    Role            : ${comp.role}`);
  parts.push(`    Version         : ${comp.version}`);
  if (comp.versionScope) parts.push(`    Version scope   : ${comp.versionScope}`);
  parts.push(`    Homepage        : ${comp.homepage}`);
  parts.push(`    License         : ${comp.spdx}`);
  parts.push(`    Copyright       : ${comp.copyright}`);
  if (comp.note) parts.push('', indent(wrap(comp.note), '    '));
  if (comp.licenseFiles.length === 0) {
    parts.push('    License text    : none required (see the note above)');
  }
  for (const file of comp.licenseFiles) {
    const lic = readLicenseFile(file, manifest);
    if (lic.bytes <= INLINE_LIMIT) {
      parts.push(
        `    License text    : ${file}, reproduced in full below ` +
          `(sha256 ${lic.sha256})`,
      );
      parts.push('', indent(lic.text, '      '));
    } else {
      parts.push(
        `    License text    : shipped as LICENSES/${file} ` +
          `(${lic.bytes} bytes, sha256 ${lic.sha256})`,
      );
    }
  }
  return parts.join('\n');
}

/** Flatten `pnpm licenses list --json` into a sorted package list. */
function collectPackages(pnpmJsonPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(pnpmJsonPath, 'utf8'));
  } catch (error) {
    fail(`cannot read --pnpm-json ${pnpmJsonPath}: ${error.message}`);
  }
  const packages = [];
  for (const [licenseId, items] of Object.entries(raw)) {
    for (const item of items ?? []) {
      packages.push({
        name: item.name,
        version: (item.versions ?? []).join(', ') || 'unknown',
        licenseId,
        homepage: item.homepage ?? '',
        author:
          typeof item.author === 'string'
            ? item.author
            : (item.author?.name ?? '') + (item.author?.email ? ` <${item.author.email}>` : ''),
        dir: (item.paths ?? [])[0] ?? '',
      });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read a package's own license file. package.json's "license" field is only a
 * declaration; MIT and BSD require the notice text itself, so ship what the
 * upstream package carries.
 */
function readPackageFile(dir, kind) {
  const LICENSE_NAMES = [
    'license',
    'license.md',
    'license.txt',
    'licence',
    'licence.md',
    'copying',
    'license-mit',
  ];
  const NOTICE_NAMES = ['notice', 'notice.txt', 'notice.md'];
  const names = kind === 'notice' ? NOTICE_NAMES : LICENSE_NAMES;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const byLower = new Map(entries.map((e) => [e.toLowerCase(), e]));
  for (const candidate of names) {
    const real = byLower.get(candidate);
    if (!real) continue;
    const full = path.join(dir, real);
    if (!fs.statSync(full).isFile()) continue;
    const text = fs
      .readFileSync(full, 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\s+$/, '');
    if (text) return text;
  }
  return null;
}

function renderJsPackages(packages, manifest) {
  const groups = new Map(); // licenseId + text hash -> { licenseId, text, members }
  const withoutText = [];
  for (const pkg of packages) {
    pkg.text = pkg.dir ? readPackageFile(pkg.dir) : null;
    pkg.origin = 'reproduced from the license file published with the package';
    pkg.notice = pkg.dir ? readPackageFile(pkg.dir, 'notice') : null;
    if (!pkg.text) {
      // Upstream shipped no license text file: fall back to the canonical text
      // we vendor for that SPDX id, and say so plainly rather than implying we
      // copied the package's own notice.
      const canonical = `spdx-${pkg.licenseId}.txt`;
      if (!manifest.licenseFiles[canonical]) {
        withoutText.push(pkg);
        continue;
      }
      pkg.text = readLicenseFile(canonical, manifest).text;
      pkg.origin =
        `the published package ships no license text file, so the canonical ` +
        `${pkg.licenseId} text (licenses/${canonical}) is reproduced, together with ` +
        `the author and homepage the package declares`;
    }
    const key = `${pkg.licenseId}\u0000${sha256(Buffer.from(pkg.text))}`;
    if (!groups.has(key)) {
      groups.set(key, { licenseId: pkg.licenseId, text: pkg.text, members: [] });
    }
    groups.get(key).members.push(pkg);
  }

  const ordered = [...groups.values()].sort(
    (a, b) =>
      a.licenseId.localeCompare(b.licenseId) ||
      a.members[0].name.localeCompare(b.members[0].name),
  );

  const out = [];
  for (const group of ordered) {
    out.push(
      group.members
        .map(
          (m) =>
            `- ${m.name}@${m.version}  [${group.licenseId}]\n` +
            `    license text: ${m.origin}\n` +
            (m.author ? `    declared author: ${m.author}\n` : '') +
            (m.homepage ? `    homepage: ${m.homepage}\n` : '') +
            (m.notice ? '    NOTICE file: reproduced after the license text below' : ''),
        )
        .join('\n'),
    );
    out.push('');
    // Always inline the text: a reference is not a reproduction, and MIT/BSD/
    // Apache all ask for the notice to travel with the copy.
    out.push(indent(group.text, '      '));
    out.push('');
    for (const m of group.members) {
      if (!m.notice) continue;
      out.push(
        indent(
          `${m.name} — its NOTICE file, reproduced because Apache-2.0 section 4(d) ` +
            'requires NOTICE to travel with derivative distributions:',
          '    ',
        ),
      );
      out.push('');
      out.push(indent(m.notice, '      '));
      out.push('');
    }
  }
  if (withoutText.length) {
    out.push(
      indent(
        wrap(
          `${withoutText.length} bundled package(s) declare a license but publish no license ` +
            'text file, and this project vendors no canonical text for that license id. ' +
            'They are listed below; their notices must be obtained from the homepage shown.',
        ),
        '    ',
      ),
    );
    out.push('');
    for (const m of withoutText) {
      out.push(`- ${m.name}@${m.version}  [${m.licenseId}]${m.homepage ? `  ${m.homepage}` : ''}`);
    }
    out.push('');
  }
  return { body: out.join('\n'), groups: ordered.length, withoutText: withoutText.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));

  if (args.resolvedVersions) {
    const resolved = JSON.parse(fs.readFileSync(args.resolvedVersions, 'utf8'));
    for (const comp of manifest.components) {
      if (resolved[comp.name]) comp.version = String(resolved[comp.name]);
    }
  }

  const wantsNative = args.platform !== 'webui';
  const wantsJs = args.platform === 'webui' || args.platform === 'all';

  // `--list-license-files` answers the question the packaging step has to ask:
  // which texts must travel in LICENSES/ for this variant?  Dumping every file
  // into every archive would put musl inside the Windows zip and winpthread
  // inside the macOS one, which is exactly the kind of sloppiness a compliance
  // review notices.
  if (args.listLicenseFiles) {
    const needed = new Set();
    for (const entry of manifest.own) {
      if (args.platform === 'all' || entry.platforms.includes(args.platform)) {
        for (const file of entry.licenseFiles) needed.add(file);
      }
    }
    if (args.platform !== 'webui') {
      for (const comp of manifest.components) {
        if (args.platform === 'all' || comp.platforms.includes(args.platform)) {
          for (const file of comp.licenseFiles) needed.add(file);
        }
      }
    }
    for (const file of [...needed].sort()) console.log(file);
    return;
  }

  const out = [];

  out.push(rule('Third-party notices for ' + (args.platform === 'all' ? 'the aria2-webui project' : `the ${args.platform} build`)));
  out.push('');
  out.push(
    wrap(
      'This file lists every third-party component linked into, embedded in or bundled ' +
        'with the software in this archive, together with the notices and license texts ' +
        'those licenses require to be reproduced. It is generated by ' +
        'scripts/gen-third-party-notices.mjs from licenses/manifest.json and the project ' +
        'lockfile, so please do not edit it by hand — change the inputs instead.',
    ),
  );
  out.push('');
  out.push(`Bundle variant    : ${args.platform}`);
  out.push(`Manifest revision : ${manifest.revision}`);
  out.push(`Project           : ${manifest.project.name} <${manifest.project.repository}>`);
  out.push(`Notice file       : NOTICE (this archive) — ${manifest.project.copyright}`);
  out.push('');

  out.push(rule('A. Software in this archive and its own license', '-'));
  out.push('');
  for (const entry of manifest.own) {
    if (!entry.platforms.includes(args.platform) && args.platform !== 'all') continue;
    out.push(renderOwn(entry, manifest));
    out.push('');
  }

  if (wantsNative) {
    const comps = manifest.components
      .filter((c) => c.platforms.includes(args.platform) || args.platform === 'all')
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push(rule('B. Third-party native components', '-'));
    out.push('');
    out.push(
      wrap(
        `The following components are compiled into the ${args.platform} binary (statically ` +
          'unless noted otherwise). Version numbers marked "resolved at build time" come ' +
          'from the build image and are restamped into this file during the release build.',
      ),
    );
    out.push('');
    for (const comp of comps) {
      out.push(renderComponent(comp, manifest));
      out.push('');
    }
  }

  if (wantsJs) {
    out.push(rule('C. Bundled JavaScript packages (embedded Web UI)', '-'));
    out.push('');
    if (!args.pnpmJson) {
      fail('--platform webui/all requires --pnpm-json from `pnpm licenses list --json --prod`');
    }
    const { body, groups, withoutText } = renderJsPackages(
      collectPackages(args.pnpmJson),
      manifest,
    );
    out.push(body);
    console.error(
      `gen-third-party-notices: ${groups} shared license text(s), ${withoutText} package(s) without a text file`,
    );
  } else {
    out.push(rule('C. Bundled JavaScript packages (embedded Web UI)', '-'));
    out.push('');
    out.push(
      wrap(
        'The Web UI embedded in this binary is itself a bundled JavaScript application with ' +
          'its own MIT/Apache-licensed dependencies. Their notices are generated from the ' +
          'same lockfile and travel with the unbundled static archive named ' +
          'aria2-webui-<version>-dist.zip on the same release page.',
      ),
    );
    out.push('');
  }

  out.push(rule('D. Obtaining the corresponding source', '-'));
  out.push('');
  out.push(wrap(manifest.correspondingSource));
  out.push('');
  out.push(`Upstream pinned at : ${manifest.upstream.repository} tag ${manifest.upstream.tag}`);
  out.push(`                     commit ${manifest.upstream.commit}`);
  out.push('');

  fs.writeFileSync(args.out, `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`, 'utf8');
  console.error(`gen-third-party-notices: wrote ${args.out}`);
}

main();
