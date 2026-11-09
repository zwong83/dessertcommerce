class Problem(Exception):
    def __init__(self, code: str, status: int, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after = retry_after


def validation(message: str = "Check the submitted information.") -> Problem:
    return Problem("VALIDATION", 422, message)


def unavailable() -> Problem:
    return Problem("DEPENDENCY_UNAVAILABLE", 503, "The ordering service is temporarily unavailable.")
