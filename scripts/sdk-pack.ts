/**
 * npm run sdk:pack — build the reference SDKs and pack them as vendorable tarballs.
 *
 * WHY: other teams vendor IMMUTABLE versioned tarballs (`"@nexus/express":
 * "file:vendor/nexus-express-1.0.0.tgz"`), served from docs/dist/files/sdk/. A tarball must be
 * self-contained, so this script FAILS when a packed package.json declares runtime
 * "dependencies", when a bundle still imports zod, or when a bundle / .d.ts still references a
 * workspace package (@nexus/*) instead of having it bundled in.
 *
 * Steps per package: npm run build -w <pkg> → bundle checks → npm pack → packed manifest check.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'dist', 'files', 'sdk');

/** The SDK workspaces, in dependency order. */
const SDK_PACKAGES = [
  { name: '@nexus/node', dir: 'packages/node' },
  { name: '@nexus/express', dir: 'packages/express' },
  { name: '@nexus/react', dir: 'packages/react' },
] as const;

const ZOD_IMPORT = /(?:require\(\s*|from\s*|import\(\s*|import\s+)["']zod(?:\/[^"']*)?["']/;
const WORKSPACE_IMPORT = /(?:require\(\s*|from\s*|import\(\s*|import\s+)["']@nexus\/[^"']+["']/;
const BUNDLE_FILE = /\.(?:c|m)?js$/;
const TYPES_FILE = /\.d\.(?:c|m)?ts$/;

class PackError extends Error {}

/** True when a CODE line (comments ignored — doc examples mention package names) matches. */
function importsMatch(source: string, pattern: RegExp): boolean {
  return source.split('\n').some((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line) && pattern.test(line));
}

/**
 * Run npm with `args` in `cwd`, returning stdout; throw on a non-zero exit.
 * WHY via npm_execpath: on Windows, spawning npm.cmd needs a shell, and a shell splits the repo
 * path at its spaces. Under `npm run`, npm_execpath is npm-cli.js — run it with node directly.
 */
function npm(args: string[], cwd: string = ROOT): string {
  const cli = process.env['npm_execpath'];
  const options = { cwd, encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'inherit'] as ['ignore', 'pipe', 'inherit'] };
  const result =
    cli !== undefined && cli.endsWith('.js')
      ? spawnSync(process.execPath, [cli, ...args], options)
      : spawnSync('npm', args, { ...options, shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new PackError(`npm ${args.join(' ')} failed (exit ${result.status ?? 'signal'})`);
  }
  return result.stdout;
}

/** Every file under a directory, recursively. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/** Assert the built bundles import neither zod nor any workspace package. */
function assertSelfContainedBundles(pkgDir: string): void {
  const files = listFiles(path.join(ROOT, pkgDir, 'dist'));
  const code = files.filter((file) => BUNDLE_FILE.test(file));
  const types = files.filter((file) => TYPES_FILE.test(file));
  if (code.length === 0) throw new PackError(`${pkgDir}: no bundles in dist/`);
  for (const file of code) {
    const source = readFileSync(file, 'utf8');
    if (importsMatch(source, ZOD_IMPORT)) throw new PackError(`${file}: imports zod — import only zod-free @nexus/shared subpaths`);
    if (importsMatch(source, WORKSPACE_IMPORT)) throw new PackError(`${file}: imports a workspace package — it must be bundled (noExternal)`);
  }
  for (const file of types) {
    const source = readFileSync(file, 'utf8');
    if (importsMatch(source, ZOD_IMPORT) || importsMatch(source, WORKSPACE_IMPORT)) {
      throw new PackError(`${file}: the .d.ts references zod or @nexus/* — consumers cannot resolve it`);
    }
  }
}

/** Read one file out of a .tgz (ustar) without external tools. */
function readFromTarball(tarballPath: string, wanted: string): string {
  const tar = gunzipSync(readFileSync(tarballPath));
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    if (name === '') break;
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    const size = Number.parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const fullName = prefix ? `${prefix}/${name}` : name;
    if (fullName === wanted) return tar.toString('utf8', offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new PackError(`${tarballPath}: ${wanted} not found`);
}

/** Assert the PACKED manifest has no runtime dependencies. */
function assertNoDependencies(tarballPath: string): void {
  const manifest = JSON.parse(readFromTarball(tarballPath, 'package/package.json')) as {
    dependencies?: Record<string, string>;
  };
  const deps = Object.keys(manifest.dependencies ?? {});
  if (deps.length > 0) {
    throw new PackError(`${path.basename(tarballPath)}: "dependencies" must be empty, found ${deps.join(', ')}`);
  }
}

/** npm pack one workspace into OUT_DIR (relative path: no spaces to quote); returns the tarball path. */
function pack(name: string, pkgDir: string): string {
  const cwd = path.join(ROOT, pkgDir);
  const output = npm(['pack', '--pack-destination', path.relative(cwd, OUT_DIR), '--json'], cwd);
  const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ filename: string }>;
  const filename = parsed[0]?.filename;
  if (!filename) throw new PackError(`npm pack ${name}: no tarball reported`);
  return path.join(OUT_DIR, path.basename(filename.replace(/^@nexus\//, 'nexus-')));
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const sdk of SDK_PACKAGES) {
    console.log(`\n▶ ${sdk.name}: build`);
    npm(['run', 'build', '-w', sdk.name]);
    assertSelfContainedBundles(sdk.dir);
    const tarball = pack(sdk.name, sdk.dir);
    assertNoDependencies(tarball);
    console.log(`✔ ${sdk.name} → ${path.relative(ROOT, tarball)}`);
  }
  console.log(`\nSDK tarballs written to ${path.relative(ROOT, OUT_DIR)}`);
}

try {
  main();
} catch (error) {
  console.error(`\n✖ sdk:pack failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
