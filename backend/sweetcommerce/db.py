from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg.pq import TransactionStatus
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .clock import iso as iso


class Database:
    def __init__(self, dsn: str, *, max_size: int = 8):
        self.pool = ConnectionPool(
            dsn,
            kwargs={
                "row_factory": dict_row,
                "connect_timeout": 2,
                "options": "-c search_path=sweetcommerce -c statement_timeout=5000 -c timezone=UTC",
            },
            min_size=0,
            max_size=max_size,
            timeout=2,
            open=False,
        )

    def open(self) -> None:
        self.pool.open()

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        with self.pool.connection() as connection:
            yield connection

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        with self.connection() as connection, connection.transaction():
            yield connection
            if connection.info.transaction_status == TransactionStatus.INERROR:
                raise RuntimeError("PostgreSQL did not commit the transaction")


def one(connection, query, params=None):
    return connection.execute(query, params).fetchone()


def rows(connection, query, params=None):
    return connection.execute(query, params).fetchall()
