from typing import TypedDict


class CartLine(TypedDict):
    variantId: str
    quantity: int
    product: str
    variant: str
    unitMinor: int
    available: bool


class Cart(TypedDict):
    version: int
    lines: list[CartLine]
    referenceSubtotalMinor: int


def valid_quantity(value: object) -> bool:
    return type(value) in (int, float) and 0 <= value <= 999 and value == int(value)
