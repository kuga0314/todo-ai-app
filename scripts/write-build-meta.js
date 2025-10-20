import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function buildMetadata() {
  const pkg = readPackageJson();
  const version = pkg?.version || "dev";
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

function main() {
  const meta = buildMetadata();
  writeMetadataFile(meta);
}

main();
