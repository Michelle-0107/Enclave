"""Management-only review target; public community projections stay unchanged."""
from pydantic import Field
from ..reports.issues import CommunityIssue


class ReviewIssue(CommunityIssue):
    # Required nullable field: fail closed if SQL 018 has not been installed.
    # Null means the issue still blocks routes, but is not awaiting approval.
    review_ticket_id: str | None = Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')
