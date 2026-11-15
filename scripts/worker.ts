// Keep the established npm entry point while the Worker runs in Python.
import { startPython, waitForExit } from "./python-runtime";

const worker = startPython("sweetcommerce.worker");
const stop = () => worker.kill("SIGTERM");
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
waitForExit(worker)
  .then((code) => { process.exitCode = code; })
  .catch(() => {
    process.stderr.write("The Python worker could not start. Check the local Python environment.\n");
    process.exitCode = 1;
  })
  .finally(() => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  });
