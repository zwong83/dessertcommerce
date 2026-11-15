"""Keep domain types compatible with the existing database and HTTP boundaries."""

import json
import re

import pytest
from sweetcommerce.capacity.domain import FulfilmentMode
from sweetcommerce.catalogue.domain import CatalogueValidationProblem, ProductStatus
from sweetcommerce.events.domain import EventStatus
from sweetcommerce.identity.domain import Purpose, Role
from sweetcommerce.order.domain import OrderStatus, PaymentMethod
from sweetcommerce.problems import (
    AccessDenied,
    AuthenticationRequired,
    DependencyUnavailable,
    InvalidTransition,
    ResourceNotFound,
    ValidationProblem,
    VersionConflict,
)
from sweetcommerce.settlement.domain import ChargeState


@pytest.mark.parametrize("enum,table,column", [
    (Role, "account", "role"),
    (Purpose, "otp_challenge", "purpose"),
    (FulfilmentMode, "standard_order", "fulfilment"),
    (PaymentMethod, "standard_order", "payment_method"),
    (ProductStatus, "product", "status"),
    (OrderStatus, "standard_order", "status"),
    (EventStatus, "event_application", "status"),
    (ChargeState, "charge", "state"),
])
def test_domain_enums_match_database_constraints_and_round_trip(db, enum, table, column):
    with db.connection() as connection:
        checks = connection.execute("""
            SELECT pg_get_constraintdef(c.oid) AS definition
              FROM pg_constraint c
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
             WHERE c.conrelid = %s::regclass AND c.contype = 'c'
               AND cardinality(c.conkey) = 1 AND a.attname = %s
        """, (table, column)).fetchall()
        allowed = {
            value for check in checks
            for value in re.findall(r"'([A-Z_]+)'::text", check["definition"])
        }
        assert {member.value for member in enum} == allowed
        for member in enum:
            stored = connection.execute("SELECT %s::text AS value", (member,)).fetchone()["value"]
            assert stored == member.value
            assert json.loads(json.dumps(member)) == stored
            assert enum(stored) is member


@pytest.mark.parametrize("problem,status,code", [
    (AuthenticationRequired(), 401, "UNAUTHENTICATED"),
    (AccessDenied("Access denied."), 403, "FORBIDDEN"),
    (ResourceNotFound("Resource missing."), 404, "NOT_FOUND"),
    (VersionConflict("Refresh first."), 409, "VERSION_CONFLICT"),
    (InvalidTransition("Action unavailable."), 409, "INVALID_TRANSITION"),
    (ValidationProblem(), 422, "VALIDATION"),
    (DependencyUnavailable(), 503, "DEPENDENCY_UNAVAILABLE"),
    (CatalogueValidationProblem("name", "REQUIRED", "Enter a name."), 422, "VALIDATION"),
])
def test_typed_problems_keep_http_contract_and_validation_details(client, problem, status, code):
    def fail():
        raise problem

    client.app.add_api_route("/__test/problem", fail)
    response = client.get("/__test/problem")
    assert response.status_code == status
    assert response.headers["content-type"] == "application/problem+json"
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["code"] == code
    assert body["message"] == str(problem)
    assert body["retryable"] is (status == 503)
    assert body["requestId"] == response.headers["x-request-id"]
    if isinstance(problem, CatalogueValidationProblem):
        assert body["fieldErrors"] == [{"field": "name", "code": "REQUIRED"}]
    else:
        assert "fieldErrors" not in body
