import re
from base64 import b64decode, b64encode
from io import BytesIO

from PIL import Image, ImageOps

from ..problems import validation
from ..values import field_string

SECTION_IDS = ("header", "billing", "items", "payment", "footer")
DEFAULT_TEMPLATE = {
    "order": list(SECTION_IDS),
    "header": {
        "title": "Invoice", "issuer": "Gather Dessert", "issuerDetails": "",
        "accent": "#FE8F95", "logo": None,
    },
    "billing": {"billedTo": "Billed to", "venue": "Event venue"},
    "items": {
        "description": "Description", "quantity": "Qty", "unitPrice": "Unit price",
        "amount": "Amount (MYR)", "style": "tinted",
    },
    "payment": {"heading": "Payment instructions", "instructions": ""},
    "footer": {"visible": False, "text": ""},
}

TEXT_LIMITS = {
    "header": {"title": 32, "issuer": 90, "issuerDetails": 280},
    "billing": {"billedTo": 42, "venue": 42},
    "items": {"description": 40, "quantity": 16, "unitPrice": 24, "amount": 24},
    "payment": {"heading": 48, "instructions": 480},
    "footer": {"text": 480},
}
OPTIONAL_TEXT = {"issuerDetails", "instructions", "text"}
MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_REQUEST_BYTES = ((MAX_LOGO_BYTES + 2) // 3) * 4 + 16_384
_formats = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


def invoice_logo(value):
    if value is None:
        return None
    if not isinstance(value, dict) or value.keys() != {"mediaType", "data"}:
        raise validation("Choose a JPEG, PNG or WebP logo.")
    media, data = value["mediaType"], value["data"]
    if not isinstance(media, str) or media not in _formats or not isinstance(data, str):
        raise validation("Choose a JPEG, PNG or WebP logo.")
    try:
        image = b64decode(data, validate=True)
        if len(image) > MAX_LOGO_BYTES:
            raise validation("Choose a logo up to 2 MiB.")
        with Image.open(BytesIO(image), formats=[_formats[media]]) as source:
            if source.width * source.height > 16_000_000 or source.n_frames != 1:
                raise validation("Choose a still logo under 16 megapixels.")
            logo = ImageOps.exif_transpose(source).convert("RGBA")
            logo.thumbnail((256, 256))
            stream = BytesIO()
            logo.save(stream, "WEBP", lossless=True)
    except (OSError, ValueError, Image.DecompressionBombError):
        raise validation("Choose a valid JPEG, PNG or WebP logo.") from None
    return {"mediaType": "image/webp", "data": b64encode(stream.getvalue()).decode("ascii")}


def validated_template(value):
    if not isinstance(value, dict) or value.keys() != DEFAULT_TEMPLATE.keys():
        raise validation("Check the invoice template sections.")
    order = value["order"]
    if (not isinstance(order, list) or not all(isinstance(key, str) for key in order)
            or len(order) != len(SECTION_IDS) or set(order) != set(SECTION_IDS)):
        raise validation("Include each invoice section once.")

    result = {"order": order}
    for section in SECTION_IDS:
        settings = value[section]
        if not isinstance(settings, dict) or settings.keys() != DEFAULT_TEMPLATE[section].keys():
            raise validation("Check the invoice section settings.")
        result[section] = dict(settings)
        for name, limit in TEXT_LIMITS[section].items():
            entry = settings[name]
            if name in OPTIONAL_TEXT and isinstance(entry, str) and not entry.strip():
                entry = ""
            else:
                entry = field_string(entry, f"the {section} section text", max_length=limit).strip()
            result[section][name] = entry

    accent = result["header"]["accent"]
    if not isinstance(accent, str) or re.fullmatch(r"#[0-9a-fA-F]{6}", accent) is None:
        raise validation("Choose a six-digit accent color.")
    result["header"]["accent"] = accent.upper()
    result["header"]["logo"] = invoice_logo(result["header"]["logo"])
    if result["items"]["style"] not in ("tinted", "plain", "striped"):
        raise validation("Choose an available table style.")
    if type(result["footer"]["visible"]) is not bool:
        raise validation("Choose whether the notes and footer section is visible.")
    return result


def template_version(value):
    if isinstance(value, str) and re.fullmatch(r'"[1-9][0-9]{0,9}"', value) and int(value[1:-1]) < 2**31 - 1:
        return int(value[1:-1])
    raise validation("Send the current invoice template version in If-Match.")
