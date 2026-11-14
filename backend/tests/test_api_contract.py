import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from conftest import API, ORIGIN

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "output/SD/contracts/sweetcommerce-v1.0.4.openapi.json").read_text())
PORT_OPERATIONS = {
    "startCustomerChallenge", "verifyCustomerChallenge", "startAdminSession", "startAdminChallenge",
    "getSession", "logoutSession", "listCatalog", "getCart", "setCartQuantity", "evaluateAvailability",
    "submitOrder", "getOwnOrder", "createProduct", "listMerchantProducts", "updateProduct", "getMerchantProduct",
    "configureCapacity", "reviewCheckout", "getCapacityCalendar", "getOwnCommandOutcome", "getCheckoutOutcome",
    "abandonOrResolveCheckout", "uploadProductPhoto", "getMerchantProductPhoto", "getListedProductPhoto",
    "previewCapacityImpact", "getOperatingPolicy", "updateOperatingPolicy", "getListedProduct",
    "listOwnOrders", "getMerchantOrder", "confirmDeliveryFee", "quoteDeliveryFee", "changeStandardOrder",
    "cancelOwnOrder", "rescheduleStandardOrder", "createDeliveryAdjustment",
    "submitChargeProof", "listPaymentProofs", "getPaymentProofContent", "getChargeForReview", "confirmReceipt",
    "rejectProof", "openSettlementCase", "resolveSettlementCase", "reserveRefund", "recordRefund",
    "reconcileRefundIntent", "listMerchantWork",
}


COMMERCIAL = json.loads((ROOT / "output/SD/contracts/sweetcommerce-v1.0.4.1.openapi.json").read_text())
CUSTOMER_AUTH = json.loads((ROOT / "output/SD/contracts/customer-auth-v1.openapi.json").read_text())
INVOICES = json.loads((ROOT / "output/SD/contracts/event-invoices-v1.openapi.json").read_text())


def _paths(document):
    for path, methods in document["paths"].items():
        for method, operation in methods.items():
            if "operationId" in operation:
                yield method, path, operation


def _assert_json_contract(response, operation_id):
    operation = next(op for _, _, op in _paths(CONTRACT) if op["operationId"] == operation_id)
    data = operation["responses"][str(response.status_code)]
    if "$ref" in data:
        data = CONTRACT["components"]["responses"][data["$ref"].rsplit("/", 1)[-1]]
    content_type = response.headers["content-type"].split(";", 1)[0]
    schema = data["content"][content_type]["schema"]
    validator = Draft202012Validator({"components": CONTRACT["components"], **schema}, format_checker=FormatChecker())
    validator.validate(response.json())


def test_python_provider_exposes_all_standard_operations(client):
    def without_names(path):
        return re.sub(r"\{[^}]+\}", "{}", path)

    reference = {
        (method, API + without_names(path))
        for method, path, operation in _paths(CONTRACT)
        if operation["operationId"] in PORT_OPERATIONS
    }
    assert len(reference) == len(PORT_OPERATIONS) == 49
    actual = {(method, without_names(path)) for method, path, _ in _paths(client.app.openapi())}
    assert reference <= actual


def test_python_provider_matches_commercial_and_extension_operation_paths(client):
    def normalize(document, prefix=""):
        return {(method, prefix + re.sub(r"\{[^}]+\}", "{}", path))
                for method, path, _ in _paths(document)}

    expected = normalize(COMMERCIAL, API)
    assert len(expected) == 61
    auth = normalize(CUSTOMER_AUTH, API)
    assert len(auth) == 12 and not expected & auth
    invoices = normalize(INVOICES, API)
    assert len(invoices) == 9 and not invoices & (expected | auth)
    assert normalize(client.app.openapi()) == expected | auth | invoices


@pytest.mark.parametrize(("path", "operation"), [
    ("/session", "getSession"),
    ("/cart", "getCart"),
    ("/catalog", "listCatalog"),
])
def test_authenticated_reads_match_approved_response_schema(client, sign_in, path, operation):
    _, headers = sign_in()
    response = client.get(API + path, headers=headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    _assert_json_contract(response, operation)


def test_http_error_and_session_cookie_metadata(client, sign_in):
    _, headers = sign_in()
    invalid = client.post(API + "/auth/otp/challenges", content="{",
                          headers={"Origin": ORIGIN, "Content-Type": "application/json"})
    assert invalid.status_code == 400
    assert invalid.json()["requestId"] == invalid.headers["x-request-id"]
    _assert_json_contract(invalid, "startCustomerChallenge")

    logged_out = client.post(API + "/session/logout", headers=headers)
    assert logged_out.status_code == 204 and not logged_out.content
    assert "Max-Age=0" in logged_out.headers["set-cookie"]
    rejected = client.get(API + "/session", headers=headers)
    assert rejected.status_code == 401
    _assert_json_contract(rejected, "getSession")
