import os

import uvicorn

from .api import create_app
from .problems import Problem


def main() -> None:
    try:
        port = int(os.environ.get("SWEETCOMMERCE_API_PORT", "8000"))
        if not 1024 <= port <= 65535:
            raise ValueError
        app = create_app()
    except (Problem, ValueError):
        raise SystemExit("SweetCommerce API configuration is invalid.") from None
    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False)


if __name__ == "__main__":
    main()
