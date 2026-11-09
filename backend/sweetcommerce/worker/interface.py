import json
import os
import signal
import sys
from collections.abc import Callable
from threading import Event

from ..db import Database
from .application import poll_expiry


def run_worker(poll: Callable[[], object], stop: Event, interval_ms: int = 1_000) -> None:
    while not stop.is_set():
        poll()
        stop.wait(interval_ms / 1000)


def main() -> None:
    from ..notices.application import poll_notice
    from ..notices.transport import ChannelTransport

    connection_string = os.environ.get("SWEETCOMMERCE_WORKER_DATABASE_URL")
    if not connection_string:
        raise RuntimeError("Worker database configuration is required.")
    mode = os.environ.get("SWEETCOMMERCE_WORKER_MODE", "all")
    if mode not in ("all", "timers", "notices"):
        raise RuntimeError("Invalid worker mode.")
    delivery = ChannelTransport.from_environment() if mode != "timers" else None
    db = Database(connection_string, max_size=4)
    stop = Event()

    def stop_on_signal(_signum, _frame):
        stop.set()

    signal.signal(signal.SIGINT, stop_on_signal)
    signal.signal(signal.SIGTERM, stop_on_signal)
    def poll():
        if mode != "notices":
            for _ in range(20):
                if stop.is_set() or poll_expiry(db) is None:
                    break
        if delivery is not None and not stop.is_set():
            poll_notice(db, delivery)

    db.open()
    try:
        run_worker(poll, stop)
    finally:
        db.close()


def cli() -> int:
    try:
        main()
    except Exception:
        print(json.dumps({"feature": "worker", "action": "run", "outcome": "failed"}, separators=(",", ":")),
              file=sys.stderr)
        return 1
    return 0
