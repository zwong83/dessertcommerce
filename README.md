# DessertCommerce

SweetCommerce is Gather Dessert’s standard-order and dessert-table booking application with separate customer and merchant routes. Next.js, React and TypeScript serve both surfaces. FastAPI serves the versioned API, and an independent Python worker handles durable work on PostgreSQL 16. The delivery checklist lives in [OpenSpec](openspec/changes/standard-dessert-ordering/tasks.md).

The Next.js application lives in `frontend/`, including its routes, UI, API contracts and server helpers. The Python API and worker live in `backend/`. Run the npm commands from the repository root; they select `frontend/` as the Next.js project directory.

## Run the isolated development environment

Use Node.js 22.13 or newer and Python 3.12. The launcher starts Next.js, FastAPI, the Python worker and a disposable PostgreSQL 16 instance. It connects the frontend to the API automatically. Set `SWEETCOMMERCE_PYTHON` to use a different Python 3.12 environment with the same dependencies.

### Windows and IntelliJ IDEA

From the repository root in PowerShell, install dependencies once:

```powershell
npm ci
$sweetVenv = Join-Path (Split-Path -Parent (Get-Location).Path) '.venv'
py -3.12 -m venv $sweetVenv
& "$sweetVenv\Scripts\python.exe" -m pip install -r backend/requirements-test.txt
& "$sweetVenv\Scripts\python.exe" -m pip check
```

Open the repository root in IntelliJ IDEA. With Node.js support enabled and a project Node.js runtime selected, run **SweetCommerce Local** from the run configuration dropdown. For Python editing, enable the Python plugin and select `.venv\Scripts\python.exe` in the parent `DessertCommerce` folder as an existing Python SDK. The launcher prefers that interpreter on Windows. If you previously set `SWEETCOMMERCE_PYTHON` in the run configuration, remove the override or point it to the new interpreter.

If the npm run configuration is unavailable, run these commands in IntelliJ's PowerShell terminal:

```powershell
$env:SWEETCOMMERCE_SYNTHETIC_OTP = '123456'
npm run dev:isolated
```

### macOS and Linux

```sh
npm ci
UV_PYTHON_INSTALL_DIR="$PWD/.cache/python" uv --cache-dir .cache/uv venv --python 3.12 .cache/python-venv
uv --cache-dir .cache/uv pip install --python .cache/python-venv/bin/python -r backend/requirements-test.txt
SWEETCOMMERCE_SYNTHETIC_OTP=123456 npm run dev:isolated
```

Open `http://127.0.0.1:3000`. Use `+60000000002` for a synthetic customer, or open `/merchant/login` and use the enrolled synthetic merchant number `+60000000001`. Verify with the configured test code. The launcher binds to loopback and uses synthetic verification and payment data. The database starts fresh each time; changes made during a session are temporary. Stop the run in IntelliJ or press `Ctrl+C` in the terminal.

Customer features include catalogue, persistent cart, checkout, order tracking, proof upload, and dessert-table applications and quotes. Merchant features include production capacity, order fulfilment, payment and refund reconciliation, event planning and closure, notification follow-up, and MYT/MYR reporting. The local environment uses simulated delivery and verification.

Customer sign-up creates a password account without a verification code by default. Enter a contact number, such as `+60000000003`, and use a password of at least 8 characters with a lowercase letter, an uppercase letter, a digit and a punctuation symbol. Customer login uses username and password. Set `SWEETCOMMERCE_CUSTOMER_PHONE_VERIFICATION=true` on both the frontend and API to restore phone login and require verification during sign-up. See the [customer authentication extension](output/SD/customer-authentication.md).

## Run with a persistent PostgreSQL database on Windows

Install PostgreSQL 16 in the default Windows location. From the repository root, run `& ..\.venv\Scripts\python.exe .\scripts\setup-local-postgres.py` and enter the installer password for the PostgreSQL user `postgres`. The script creates `sweetcommerce_local` and its three application roles and saves their connection settings and the local identity key in the Git-ignored `.env.persistent.local`.

Run **SweetCommerce Persistent** in IntelliJ or use `npm run dev:persistent`. The launcher starts the default Windows PostgreSQL installation if needed, applies migrations, and starts FastAPI, the worker, and Next.js. This database starts empty and keeps its records when the app stops. To restore customer verification for this run configuration, set `SWEETCOMMERCE_CUSTOMER_PHONE_VERIFICATION=true` in the local settings file and restart the app.

## Backend processes

Run the following modules from `backend/` with the project Python environment. Supply settings through the process environment.

| Process | Module | Database role |
| --- | --- | --- |
| Migrations | `python -m sweetcommerce.migrate` | `SWEETCOMMERCE_MIGRATION_DATABASE_URL` |
| API | `python -m sweetcommerce` | `DATABASE_URL` |
| Worker | `python -m sweetcommerce.worker` | `SWEETCOMMERCE_WORKER_DATABASE_URL` |

Set `SWEETCOMMERCE_ORIGIN` on FastAPI to the browser-facing origin and `SWEETCOMMERCE_API_ORIGIN` on Next.js to the private API origin. The API defaults to port 8000 on loopback. The API and worker have separate database roles. The existing `npm run worker` command launches the Python worker. Set `SWEETCOMMERCE_WORKER_MODE` to `timers` or `notices` to run those workloads separately. The default runs both.

## Deploy with shared state

Use the same release, public origin, identity key and configuration across API instances. Use the same PostgreSQL database and private object namespace across machines. Apply all migrations once with the migration role before releasing the compatible web, API and workers. Check the private FastAPI `/internal/live` and `/internal/ready` endpoints. Keep FastAPI on a private network behind Next.js. The default Python entry point binds to loopback. An internal deployment can launch the ASGI factory `sweetcommerce.api:create_app` through its process supervisor.

| Setting | Use |
| --- | --- |
| `SWEETCOMMERCE_IDENTITY_KEY`, `SWEETCOMMERCE_DB_POOL` | Shared base64url-encoded 32-byte identity key and API connections per process. Budget database connections across all replicas. |
| `SWEETCOMMERCE_OTP_GATEWAY_URL`, `SWEETCOMMERCE_OTP_GATEWAY_BEARER` | HTTPS OTP gateway. Accept the approved destination, code, role and purpose with HTTP 202. |
| `SWEETCOMMERCE_OBJECT_GATEWAY_URL`, `SWEETCOMMERCE_OBJECT_GATEWAY_BEARER`, `SWEETCOMMERCE_OBJECT_KEY` | Shared HTTPS private object namespace. Support atomic create with `If-None-Match: *`, read and delete. Use the same 32-byte base64url key across replicas. Existing files use the original derived key and envelope. |
| `SWEETCOMMERCE_NOTICE_ENDPOINT`, `SWEETCOMMERCE_NOTICE_BEARER`, `SWEETCOMMERCE_NOTICE_FALLBACK_CHANNELS` | HTTPS notice gateway. Receive the selected channel, approved template data and idempotency key. Return `DELIVERED` or `FAILED` and set `retryable` only for safe retries. Unknown sends require merchant reconciliation. Configure approved SMS or email fallback separately. |
| `SWEETCOMMERCE_TERMS_VERSION`, `SWEETCOMMERCE_TERMS_TEXT`, `SWEETCOMMERCE_PICKUP_DISPLAY`, `SWEETCOMMERCE_DUITNOW_QR_URL`, `SWEETCOMMERCE_WHATSAPP_URL` | Merchant-confirmed customer terms, pickup details, payment QR and support contact. |

For recovery, restore PostgreSQL and the corresponding private object namespace together in isolation. Reconcile active windows and holds, posted receipts, reserved refunds and ambiguous notices before reopening writes. Authorized operators can pipe up to 25 approved inventory candidates into `python -m sweetcommerce.proofs.reconcile`. It rechecks references before deleting an unlinked object. Production gateway enrollment, real merchant data and payment verification, retention policy and commercial acceptance require owner sign-off.

## Verify the migration

```sh
npm run check
npm run build
node_modules/.bin/tsx scripts/test-python.ts
node_modules/.bin/tsx scripts/test-web-python.ts
openspec validate --all --strict
```

The TypeScript tests retain the pre-migration baseline and frontend coverage. The Python tests exercise both increments, the worker and provider boundaries on an isolated PostgreSQL 16 instance. The web bridge test starts the built Next.js app, FastAPI and the Python worker against data written by the previous runtime.
