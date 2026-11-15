class Problem(Exception):
    def __init__(self, code: str, status: int, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after = retry_after


class ValidationProblem(Problem):
    def __init__(self, message: str = "Check the submitted information."):
        super().__init__("VALIDATION", 422, message)


class AuthenticationRequired(Problem):
    def __init__(self, message: str = "Sign in to continue."):
        super().__init__("UNAUTHENTICATED", 401, message)


class AccessDenied(Problem):
    def __init__(self, message: str):
        super().__init__("FORBIDDEN", 403, message)


class ResourceNotFound(Problem):
    def __init__(self, message: str):
        super().__init__("NOT_FOUND", 404, message)


class VersionConflict(Problem):
    def __init__(self, message: str):
        super().__init__("VERSION_CONFLICT", 409, message)


class InvalidTransition(Problem):
    def __init__(self, message: str):
        super().__init__("INVALID_TRANSITION", 409, message)


class DependencyUnavailable(Problem):
    def __init__(self, message: str = "The ordering service is temporarily unavailable."):
        super().__init__("DEPENDENCY_UNAVAILABLE", 503, message)


def validation(message: str = "Check the submitted information.") -> ValidationProblem:
    return ValidationProblem(message)


def unavailable() -> DependencyUnavailable:
    return DependencyUnavailable()
