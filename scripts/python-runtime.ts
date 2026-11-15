import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const backend = join(project, "backend");
const pythonExecutable = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";

export function pythonInterpreter(): string {
  if (process.env.SWEETCOMMERCE_PYTHON) return process.env.SWEETCOMMERCE_PYTHON;
  if (process.platform === "win32") {
    const parentVenvPython = fileURLToPath(new URL("../../.venv/Scripts/python.exe", import.meta.url));
    if (existsSync(parentVenvPython)) return parentVenvPython;
    const localPython = join(homedir(), "venvs", "SweetCommerce", "Scripts", "python.exe");
    if (existsSync(localPython)) return localPython;
  }
  return join(project, ".venv", pythonExecutable);
}

export async function syncPythonDependencies() {
  const python = resolve(pythonInterpreter());
  const venv = dirname(dirname(python));
  if (!existsSync(python) || !existsSync(join(venv, "pyvenv.cfg"))) {
    throw new Error("Create a Python 3.12 virtual environment and install uv there. See README.md.");
  }

  const child = spawn(python, [
    "-m", "uv", "sync", "--locked", "--inexact", "--no-active", "--no-python-downloads", "--python", python,
  ], {
    cwd: project,
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: venv },
    stdio: "inherit",
  });
  if (await waitForExit(child)) throw new Error("Could not sync Python dependencies with uv. See the output above and README.md.");
}

export function startPython(module: string, args: string[] = [], env = process.env) {
  return spawn(pythonInterpreter(), ["-B", "-m", module, ...args], {
    cwd: backend, env, stdio: "inherit",
  });
}

export function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1)));
  });
}
