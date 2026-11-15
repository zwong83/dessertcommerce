import { syncPythonDependencies } from "./python-runtime";

syncPythonDependencies().catch((error: Error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
