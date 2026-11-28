# DessertCommerce

SweetCommerce is Gather Dessert’s standard-order and dessert-table booking application with separate customer and merchant routes. Next.js, React and TypeScript serve both surfaces. FastAPI serves the versioned API, and an independent Python worker handles durable work on PostgreSQL 16. The delivery checklist lives in [OpenSpec](openspec/changes/standard-dessert-ordering/tasks.md).

The Next.js application lives in `frontend/`, including its routes, UI and API contracts. Its `server/http/` helpers forward requests to Python, read sessions and format web errors. The Python API, business logic, database access and worker live in `backend/`. Local launchers live in `scripts/`. Run the npm commands from the repository root; they select `frontend/` as the Next.js project directory.

## Run with the installed PostgreSQL database

Use Node.js 22.13 or newer, Python 3.12, and PostgreSQL 16. The launcher starts Next.js, FastAPI, and the Python worker against the installed `sweetcommerce_local` database. Set `SWEETCOMMERCE_PYTHON` to use a different Python 3.12 environment with the same dependencies.

### Windows and IntelliJ IDEA

From the repository root in PowerShell, install the Node.js packages, create the Python environment if needed, and install uv once into it:

```powershell
npm ci
$sweetVenv = Join-Path (Split-Path -Parent (Get-Location).Path) '.venv'
if (-not (Test-Path "$sweetVenv\Scripts\python.exe")) { py -3.12 -m venv $sweetVenv }
& "$sweetVenv\Scripts\python.exe" -m pip install uv==0.13.8
npm run python:sync
```

Open the project in IntelliJ IDEA. For Python editing, enable the Python plugin and select `.venv\Scripts\python.exe` in the parent `DessertCommerce` folder as an existing Python SDK. The launcher prefers that interpreter on Windows. If `SWEETCOMMERCE_PYTHON` is set in the run configuration, point it to the same interpreter or remove the override.

Python dependencies are declared in `pyproject.toml`. The `dev` group holds test dependencies. When you click **Run** for **SweetCommerce Persistent**, uv syncs the selected virtual environment from `uv.lock` before the app starts. The launcher uses an inexact sync so it keeps tools such as uv and pip in that environment. Use `npm run python:sync` when you want to install dependencies without starting the app.

To add a backend dependency, run the following from the repository root with the package name you need. Add `--dev` for a test-only dependency. Commit both `pyproject.toml` and `uv.lock`. You can also click **Run** to do the sync.

```powershell
& ..\.venv\Scripts\python.exe -m uv add --no-sync package-name
npm run python:sync
```

Customer sign-up creates a password account without a verification code by default. Enter a contact number, such as `+60000000003`, and use a password of at least 8 characters with a lowercase letter, an uppercase letter, a digit and a punctuation symbol. Customer login uses username and password. Set `SWEETCOMMERCE_CUSTOMER_PHONE_VERIFICATION=true` on both the frontend and API to restore phone login and require verification during sign-up. See the [customer authentication extension](output/SD/customer-authentication.md).

Merchant login uses username and password. The login card explains how to obtain a private setup link. Opening that link displays the merchant registration form. Set `SWEETCOMMERCE_MERCHANT_CODE_AUTHENTICATION=true` in the run environment to also offer code login and recovery.

Install PostgreSQL 16 in the default Windows location. From the repository root, run `& ..\.venv\Scripts\python.exe .\scripts\setup-local-postgres.py` and enter the installer password for the PostgreSQL user `postgres`. The script creates `sweetcommerce_local` and its three application roles and saves their connection settings and the local identity key in the Git-ignored `.env.persistent.local`.

Run **SweetCommerce Persistent** in IntelliJ or use `npm run dev:persistent`. The launcher starts the installed Windows PostgreSQL server if needed and applies migrations. Open `http://127.0.0.1:3000`. Accounts, orders, and invoice templates are retained across restarts. The local app uses simulated delivery and verification. To restore customer code verification, set `SWEETCOMMERCE_CUSTOMER_PHONE_VERIFICATION=true` in the local settings file and restart the app.

To set up the merchant without a verification code, start **SweetCommerce Persistent** to apply the migrations. In IntelliJ's Windows PowerShell terminal at the repository root, run `npm.cmd run merchant:setup -- --phone +60123456789` with your own international phone number. Use `npm.cmd` explicitly so Windows PowerShell forwards the `--phone` option correctly. Open the generated link and fill in the Sign up form. The link expires in 30 minutes and can be used once. Keep it private. When credentials are already set up, log in with the existing username and password.

### Open PostgreSQL in IntelliJ's terminal

Run this in IntelliJ's PowerShell terminal and enter the password you set for the `postgres` user during installation.

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d sweetcommerce_local -W
```

At the `sweetcommerce_local` prompt, use `\conninfo` to check the connection, `\dt sweetcommerce.*` to list the application tables, or `\q` to exit.

## iPhone Home Screen web app

The frontend includes a standalone web manifest, Gather Dessert PNG icons and an Apple touch icon. On iPhone, open the HTTPS website in Safari, choose **Share → Add to Home Screen**, enable **Open as Web App** if available, then **Add**. Installation does not require an App Store release.

The service worker registers only in production on secure contexts. It caches only `/offline.html`; account pages, orders, invoices, API responses and payment requests are never cached by it. Offline navigation shows a reconnect message. It does not queue or replay purchases/uploads. After a lost connection during submission, inspect the order status before retrying. Offline support starts after the first successful online visit and worker installation.

For a production-like local check, build an isolated copy with `npm run build`, then run `npm run start`. `npm run dev:persistent` remains a development launcher and does not register the worker. An iPhone cannot reach the PC through `localhost`: an HTTPS deployment or a separately configured secure test address is needed. Configure the backend's allowed origin to match that address; do not disable origin checks or expose PostgreSQL. No public tunnel or deployment is created by this change.

Regenerate committed icons from the existing logo with `node scripts/generate-pwa-icons.mjs`. When changing offline content, increment the version in `frontend/public/sw.js`. Worker updates delete only this app's older public-fallback caches. To roll back offline support, ship a replacement worker that clears those caches and unregisters itself; simply removing the registration component does not remove existing installed workers.

Before release, check Add to Home Screen, standalone navigation, sign-in, image upload, PDF download, reconnect behaviour and updates on a physical iPhone. Desktop and simulated worker checks do not establish iOS compatibility.

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

The TypeScript tests retain the pre-migration baseline in `tests/legacy-backend/` and cover the frontend. This historical implementation is used exclusively by tests to verify existing data and behavior across the Python migration. The Python tests exercise both increments, the worker and provider boundaries on an isolated PostgreSQL 16 instance. The web bridge test starts the built Next.js app, FastAPI and the Python worker against data written by the previous runtime. The boundary check scans the frontend to prevent imports of test code, launchers, backend code or PostgreSQL drivers.
