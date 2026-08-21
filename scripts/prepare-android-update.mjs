import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const args = parseArguments(process.argv.slice(2));
if (!args.apk || !args.url) {
  fail("Usage: npm run android:update:manifest -- --apk <signed.apk> --url <https-url> [--notes <text>] [--notes-file <file>] [--mandatory] [--output <file>]");
}

const projectRoot = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(resolve(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const version = String(config.version ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`Invalid SemVer in tauri.conf.json: ${version || "<empty>"}`);
}

const apkPath = resolve(projectRoot, args.apk);
const apkStats = await stat(apkPath).catch(() => undefined);
if (!apkStats?.isFile() || apkStats.size <= 0) {
  fail(`Signed APK does not exist: ${apkPath}`);
}

const downloadUrl = new URL(args.url);
if (downloadUrl.protocol !== "https:") {
  fail("Android update APK URL must use HTTPS");
}

const notes = args.notesFile
  ? (await readFile(resolve(projectRoot, args.notesFile), "utf8")).trim()
  : (args.notes ?? "性能优化与问题修复").trim();
const apkBytes = await readFile(apkPath);
const outputPath = resolve(projectRoot, args.output ?? "release/latest-mobile.json");
const manifest = {
  schemaVersion: 1,
  version,
  notes,
  pubDate: new Date().toISOString(),
  mandatory: Boolean(args.mandatory),
  apk: {
    url: downloadUrl.toString(),
    sha256: createHash("sha256").update(apkBytes).digest("hex"),
    size: apkStats.size,
    architecture: args.architecture ?? "arm64-v8a",
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Prepared ${outputPath}\nSHA256 ${manifest.apk.sha256}\n`);

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--mandatory") {
      parsed.mandatory = true;
      continue;
    }
    if (!token.startsWith("--")) fail(`Unknown argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = values[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${token}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
