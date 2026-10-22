"""Management-only review target; public community projections stay unchanged."""
from decimal import Decimal
from typing import Literal

from pydantic import Field, model_validator
from ..reports.issues import CommunityIssue


class ReviewIssue(CommunityIssue):
    # Required nullable field: fail closed if SQL 018 has not been installed.
    # Null means the issue still blocks routes, but is not awaiting approval.
    review_ticket_id: str | None = Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')
    # SQL 028 adds these fields. Older snapshots remain valid but have no price.
    estimated_cost_myr: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    cost_estimate_source: Literal['historical_median', 'provisional_benchmark', 'none'] = 'none'
    cost_estimate_sample_count: int = Field(default=0, ge=0, strict=True)

    @model_validator(mode='after')
    def historical_estimate_has_evidence(self):
        if ((self.estimated_cost_myr is None) != (self.cost_estimate_source == 'none')
                or (self.cost_estimate_sample_count == 0) != (self.cost_estimate_source == 'none')):
            raise ValueError('Cost estimate and source disagree')
        return self
