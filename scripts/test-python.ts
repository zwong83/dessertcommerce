import { fileURLToPath } from "node:url";
import { startPython, waitForExit } from "./python-runtime";
import { databaseUrl, startTestPostgres } from "../tests/postgres-harness";

async function main() {
  const cache = fileURLToPath(new URL("../.cache/", import.meta.url));
  const postgres = await startTestPostgres({ applyMigrations: false });
  try {
    const child = startPython(
      "pytest", ["-q", "-o", "cache_dir=" + cache + "pytest", "--basetemp=" + cache + "pytest-tmp", ...process.argv.slice(2)], {
        ...process.env,
        SC_TEST_MIGRATION_DSN: databaseUrl(postgres.migration),
        SC_TEST_API_DSN: databaseUrl(postgres.api),
        SC_TEST_WORKER_DSN: databaseUrl(postgres.worker),
      },
    );
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      process.exitCode = await waitForExit(child);
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } finally {
    await postgres.close();
  }
}

main().catch(() => {
  process.stderr.write("The isolated Python test runner could not start. Check the local Python environment.\n");
  process.exitCode = 1;
});
