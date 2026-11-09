import re

from .problems import validation

UUID_PATTERN = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", re.IGNORECASE | re.ASCII)


def field_string(value, label: str, pattern=None, max_length: int = 254) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or "\x00" in value
        or any(0xD800 <= ord(character) <= 0xDFFF for character in value)
        or len(value.encode("utf-16-le", errors="surrogatepass")) // 2 > max_length
        or (pattern is not None and not re.search(pattern, value))
    ):
        raise validation(f"Check {label}.")
    return value


def field_uuid(value, label: str) -> str:
    return field_string(value, label, UUID_PATTERN, 36)
