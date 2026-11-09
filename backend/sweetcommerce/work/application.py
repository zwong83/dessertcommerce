import base64
import binascii
import json
from datetime import date, datetime

from ..capacity.domain import require_role, uuid
from ..problems import validation
from .domain import work_item
from .infrastructure import list_work

KINDS = {"ORDER", "EVENT", "PROOF", "NOTICE", "PAYMENT_EXCEPTION"}


def _cursor(raw, filters):
    if raw is None:
        return None
    try:
        if len(raw) > 500:
            raise ValueError
        scope, anchor, identifier = json.loads(base64.b64decode(raw + "=" * (-len(raw) % 4), altchars=b"-_", validate=True))
        anchor = datetime.fromisoformat(anchor)
        if anchor.tzinfo is None or scope != filters:
            raise ValueError
        return anchor, uuid(identifier)
    except (ValueError, TypeError, binascii.Error, UnicodeError):
        raise validation("Refresh the work list and use its current page cursor.") from None


class WorkService:
    def __init__(self, db):
        self.db = db

    def list(self, actor, *, limit=None, cursor=None, kind=None, status=None, service_date=None):
        require_role(actor, "ADMIN")
        if kind is not None and kind not in KINDS:
            raise validation("Choose a work kind.")
        if status is not None and (not status.strip() or len(status) > 40):
            raise validation("Choose a work status.")
        try:
            limit = 25 if limit is None else int(limit)
            if not 1 <= limit <= 100:
                raise ValueError
            if service_date is not None and date.fromisoformat(service_date).isoformat() != service_date:
                raise ValueError
        except ValueError:
            raise validation("Choose a valid work date and page size.") from None
        filters = [kind, status, service_date]
        with self.db.connection() as conn:
            result = list_work(conn, filters, _cursor(cursor, filters), limit + 1)
        token = None
        if len(result) > limit:
            anchor = result[limit - 1]
            data = json.dumps([filters, anchor["updated_at"].isoformat(), str(anchor["id"])], separators=(",", ":")).encode()
            token = base64.urlsafe_b64encode(data).decode().rstrip("=")
        return {"items": [work_item(r) for r in result[:limit]], "nextCursor": token}
