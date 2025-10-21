import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function readPackageJson() {
  const pkgPath = path.join(rootDir, "package.json");
  const raw = readFileSync(pkgPath, "utf-8");
  return JSON.parse(raw);
}

function runGitCommand(command) {
  try {
    const stdout = execSync(command, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    return stdout.trim();
  } catch (error) {
    return "dev";
  }
}

async function readLatestChangelogVersion() {
  const changelogPath = path.join(rootDir, "src", "changelog.js");

  try {
    const changelogModule = await import(pathToFileURL(changelogPath).href);
    const changelog = changelogModule?.default;

    if (Array.isArray(changelog) && changelog.length > 0) {
      const latestEntry = changelog[0];
      if (latestEntry?.version) {
        return latestEntry.version;
      }
    }
  } catch (error) {
    console.warn("[build-meta] failed to load changelog version", error);
  }

  return null;
}

async function buildMetadata() {
  const pkg = readPackageJson();
  const changelogVersion = await readLatestChangelogVersion();
  const version = changelogVersion || pkg?.version || "dev";
  const commit = runGitCommand("git rev-parse --short HEAD");
  const branch = runGitCommand("git rev-parse --abbrev-ref HEAD");
  const builtAt = new Date().toISOString();

  const meta = {
    version,
    commit,
    branch,
    builtAt,
  };

  // ここに必要に応じて追加メタ情報を拡張できる
  // 例: meta.environment = process.env.DEPLOY_ENV || "production";

  return meta;
}

function writeMetadataFile(meta) {
  const publicDir = path.join(rootDir, "public");
  mkdirSync(publicDir, { recursive: true });
  const outputPath = path.join(publicDir, "build-meta.json");
  writeFileSync(outputPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  console.log(`ℹ️  build-meta.json generated at ${outputPath}`);
}

async function main() {
  const meta = await buildMetadata();
  writeMetadataFile(meta);
}

try {
  await main();
} catch (error) {
  console.error("❌ Failed to generate build metadata", error);
  process.exit(1);
}
