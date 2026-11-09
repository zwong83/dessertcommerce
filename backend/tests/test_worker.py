from threading import Event

import pytest

from sweetcommerce.worker import run_worker
from sweetcommerce.worker.interface import cli


def test_worker_stops_polling_after_the_in_flight_iteration_drains():
    stop = Event()
    polls = []

    def poll():
        polls.append("started")
        stop.set()
        polls.append("finished")

    run_worker(poll, stop)
    assert polls == ["started", "finished"]


def test_worker_propagates_unexpected_poll_failure_for_supervisor():
    def fail():
        raise RuntimeError("poll failed")

    with pytest.raises(RuntimeError, match="poll failed"):
        run_worker(fail, Event())


def test_worker_requires_its_own_dsn_and_emits_only_safe_error(monkeypatch, capsys):
    monkeypatch.delenv("SWEETCOMMERCE_WORKER_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "api-dsn")
    assert cli() == 1
    assert capsys.readouterr().err == '{"feature":"worker","action":"run","outcome":"failed"}\n'
