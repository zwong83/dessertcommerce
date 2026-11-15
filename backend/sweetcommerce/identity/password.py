from secrets import token_bytes
from threading import BoundedSemaphore

from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

_KDF_SLOTS = BoundedSemaphore(4)


def hash_password(password: str) -> str:
    with _KDF_SLOTS:
        return Argon2id(salt=token_bytes(16), length=32, iterations=2, lanes=1, memory_cost=19 * 1024).derive_phc_encoded(
            password.encode("utf-8")
        )


# Give unknown usernames the same KDF cost as known ones.
_DUMMY_HASH = hash_password(token_bytes(32).hex())


def password_matches(password: str, stored_hash: str | None) -> bool:
    try:
        with _KDF_SLOTS:
            Argon2id.verify_phc_encoded(password.encode("utf-8"), stored_hash or _DUMMY_HASH)
    except InvalidKey:
        return False
    return stored_hash is not None
