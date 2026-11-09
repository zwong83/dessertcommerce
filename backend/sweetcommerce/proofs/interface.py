from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from ..capacity.infrastructure import CapacityCommand
from ..http import require_session
from ..problems import Problem
from .application import ProofService
from .domain import MAX_PROOF_BYTES, MEDIA_EXTENSIONS, check_media_type, identifier, oversized, unsupported_media


async def _read_proof(request: Request) -> bytes:
    content_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    encoding = request.headers.get("content-encoding", "identity").lower()
    if content_type != "application/octet-stream" or encoding != "identity":
        raise unsupported_media()
    length = request.headers.get("content-length")
    if length is not None:
        if not length.isascii() or not length.isdecimal():
            raise Problem("VALIDATION", 400, "Provide a valid Content-Length.")
        length = length.lstrip("0") or "0"
        if len(length) > 7 or int(length) > MAX_PROOF_BYTES:
            raise oversized()
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_PROOF_BYTES:
            raise oversized()
        body.extend(chunk)
    return bytes(body)


def router(service: ProofService, identity, origin: str) -> APIRouter:
    routes = APIRouter()

    @routes.post("/charges/{chargeId}/proof", status_code=201, operation_id="submitChargeProof")
    async def submit(request: Request, chargeId: str):
        actor = await run_in_threadpool(require_session, request, identity, origin, "CUSTOMER", write=True)
        charge_id = identifier(chargeId, "charge ID")
        key = identifier(request.headers.get("idempotency-key"), "Idempotency-Key")
        media_type = check_media_type(request.headers.get("x-file-media-type"))
        data = await _read_proof(request)
        context = CapacityCommand(key, request.state.request_id)
        return await run_in_threadpool(service.submit_charge_proof, actor, charge_id, data, media_type, context)

    @routes.get("/admin/charges/{chargeId}/proofs", operation_id="listPaymentProofs")
    def proofs(request: Request, chargeId: str):
        actor = require_session(request, identity, origin, "ADMIN")
        return service.list_payment_proofs(
            actor, chargeId, limit=request.query_params.get("limit"), cursor=request.query_params.get("cursor"),
            request_id=request.state.request_id,
        )

    @routes.get("/admin/proofs/{proofId}/content", operation_id="getPaymentProofContent")
    def content(request: Request, proofId: str):
        actor = require_session(request, identity, origin, "ADMIN")
        proof_id = identifier(proofId, "proof ID")
        data, media_type = service.get_payment_proof_content(actor, proof_id, request.state.request_id)
        return Response(data, media_type="application/octet-stream", headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'attachment; filename="payment-proof-{proof_id}.{MEDIA_EXTENSIONS[media_type]}"',
            "X-Content-Type-Options": "nosniff",
        })

    return routes
