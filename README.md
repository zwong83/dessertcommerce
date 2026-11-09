# DessertCommerce

SweetCommerce is Gather Dessert’s standard-order and dessert-table booking application with separate customer and merchant routes. Next.js, React and TypeScript serve both surfaces. FastAPI serves the versioned API, and an independent Python worker handles durable work on PostgreSQL 16. The delivery checklist lives in [OpenSpec](openspec/changes/standard-dessert-ordering/tasks.md).

## Run the isolated development environment

Install the web and Python dependencies in the project. The local launcher uses Python 3.12 from `.cache/python-venv` by default. Set `SWEETCOMMERCE_PYTHON` to use another Python 3.12 environment with the same dependencies.

```sh
npm ci
UV_PYTHON_INSTALL_DIR="$PWD/.cache/python" uv --cache-dir .cache/uv venv --python 3.12 .cache/python-venv
uv --cache-dir .cache/uv pip install --python .cache/python-venv/bin/python -r backend/requirements-test.txt
SWEETCOMMERCE_SYNTHETIC_OTP=123456 npm run dev:isolated
```

Open `http://127.0.0.1:3000`. Use `+60000000002` for a synthetic customer, or open `/merchant/login` and use the enrolled synthetic merchant number `+60000000001`. Verify with the configured test code. The launcher starts the web, API, worker and disposable PostgreSQL instance on loopback. It uses synthetic verification and payment data.

Customer features include catalogue, persistent cart, checkout, order tracking, proof upload, and dessert-table applications and quotes. Merchant features include production capacity, order fulfilment, payment and refund reconciliation, event planning and closure, notification follow-up, and MYT/MYR reporting. The local environment uses simulated delivery and verification.

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
