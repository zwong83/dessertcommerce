# SweetCommerce Baseline Migration and Recovery

Greenfield, no historical data to backfill. This is a proposed plan and the linked SQL has not been executed. Design verification uses a disposable database and synthetic rows.

1. Pin the selected PostgreSQL major and migration tooling in implementation. Run the schema in a dedicated migration role, provision least-privilege API/worker roles and verify grants. No default credentials or seed accounts.
2. Prove clean bootstrap, schema checks, idempotent migration history and query plans. Seed synthetic catalog/merchant configuration through a controlled test path. Provision the actual merchant by verified contact during launch setup.
3. Promote the same versioned migration + app build. Apply additive schema before app and worker. Test old/new app compatibility. Do not remove tables/columns before support window ends and backup is verified.
4. Keep receipts and accepted orders during rollback. Prefer a compatible app rollback or forward correction; destructive rollback requires separate approval and an explicit verified recovery point. Stop mutating traffic if schema compatibility is unsafe.
5. Restore PostgreSQL and private proof objects into isolation. Compare ledger totals, active holds, audit integrity, lease state and object references. Reconcile expired jobs and ambiguous external notifications before reopening writes. Actual RPO/RTO and retention are launch acceptance decisions.

Evidence required: clean run, constraints, dump/restore smoke, cross-version API test, receipt/hold reconciliation and operator checklist.
