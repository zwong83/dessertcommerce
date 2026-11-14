from base64 import b64decode
from binascii import Error as Base64Error
from io import BytesIO

from PIL import Image, ImageOps

from ..problems import validation

MAX_AVATAR_BYTES = 2 * 1024 * 1024
MAX_AVATAR_REQUEST_BYTES = ((MAX_AVATAR_BYTES + 2) // 3) * 4 + 4096
_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
_AVATAR_SIZE = (256, 256)


def profile_avatar(value) -> bytes | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"mediaType", "data"}:
        raise validation("Choose a JPEG, PNG or WebP image.")
    media_type, data = value["mediaType"], value["data"]
    if not isinstance(media_type, str) or media_type not in _FORMATS or not isinstance(data, str):
        raise validation("Choose a JPEG, PNG or WebP image.")
    try:
        image = b64decode(data, validate=True)
    except (ValueError, Base64Error):
        raise validation("Choose a valid image.") from None
    if len(image) > MAX_AVATAR_BYTES:
        raise validation("Choose an image up to 2 MB.")
    try:
        with Image.open(BytesIO(image), formats=[_FORMATS[media_type]]) as source:
            if source.width * source.height > 16_000_000 or source.n_frames != 1:
                raise validation("Choose a still image under 16 megapixels.")
            thumbnail = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGBA"), _AVATAR_SIZE)
            result = BytesIO()
            thumbnail.save(result, "WEBP", quality=82)
            return result.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError):
        raise validation("Choose a valid JPEG, PNG or WebP image.") from None
