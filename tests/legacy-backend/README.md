# Legacy backend test reference

This directory preserves the TypeScript implementation used before the Python backend migration. Regression tests use it to verify the original behavior. `scripts/test-web-python.ts` uses it to create sessions, cart state, checkout reviews and pending orders that the current Python API and worker must accept.

The production API, business rules, database access and worker are owned by `backend/sweetcommerce/`. Add current backend behavior there. Keep this reference stable so the migration checks continue to exercise historical data.

The original migration runner applies migration 0001. The web bridge test then runs the Python migrations against that database before checking compatibility. The PostgreSQL test harness owns database provisioning and connection settings.
