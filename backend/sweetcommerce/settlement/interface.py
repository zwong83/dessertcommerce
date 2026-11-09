from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from ..capacity.infrastructure import CapacityCommand
from ..http import field_uuid, read_object, require_session

RECEIPT_FIELDS = (
    "externalReference", "amountMinor", "receivedAt", "reason", "proofId", "expectedVersion",
    "settlementCaseId", "postingMode", "lateDepositDecision",
)


def router(service, identity, origin):
    routes = APIRouter()

    def write_session(request):
        return require_session(request, identity, origin, "ADMIN", write=True)

    def context(request):
        return CapacityCommand(field_uuid(request.headers.get("idempotency-key"), "the request key"), request.state.request_id)

    @routes.get("/admin/charges/{charge_id}")
    def charge(request: Request, charge_id: str):
        actor = require_session(request, identity, origin, "ADMIN")
        return service.get_charge(actor, field_uuid(charge_id, "the charge"))

    @routes.post("/admin/charges/{charge_id}/receipts")
    async def receive(request: Request, charge_id: str):
        actor = await run_in_threadpool(write_session, request)
        data = await read_object(request, RECEIPT_FIELDS)
        return await run_in_threadpool(service.confirm_receipt, actor, field_uuid(charge_id, "the charge"), data, context(request))

    @routes.post("/admin/proofs/{proof_id}/reject")
    async def reject(request: Request, proof_id: str):
        actor = await run_in_threadpool(write_session, request)
        data = await read_object(request, ("reason", "decision", "customerSafeReason"))
        return await run_in_threadpool(service.reject_proof, actor, field_uuid(proof_id, "the proof"), data, context(request))

    @routes.post("/admin/charges/{charge_id}/settlement-cases")
    async def open_case(request: Request, charge_id: str):
        actor = await run_in_threadpool(write_session, request)
        data = await read_object(request, ("reason", "proofId", "notes"))
        return await run_in_threadpool(service.open_case, actor, field_uuid(charge_id, "the charge"), data, context(request))

    @routes.post("/admin/settlement-cases/{case_id}/resolve")
    async def resolve_case(request: Request, case_id: str):
        actor = await run_in_threadpool(write_session, request)
        data = await read_object(request, ("reason",))
        return await run_in_threadpool(service.resolve_case, actor, field_uuid(case_id, "the settlement case"), data, context(request))

    return routes
