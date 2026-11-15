import { startPython, waitForExit } from "./python-runtime";

waitForExit(startPython("sweetcommerce.identity.merchant_setup", process.argv.slice(2)))
  .then(code => { process.exitCode = code; })
  .catch(() => {
    process.stderr.write("Could not start the configured SweetCommerce Python interpreter.\n");
    process.exitCode = 1;
  });
