from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

TaskStatus = Literal['assigned', 'in_progress', 'awaiting_verification', 'changes_requested', 'resolved']


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class StaffIdentity(BaseModel):
    user_id: UUID
    role: Literal['management', 'maintenance']
    display_name: str
    team_id: UUID | None = None


class TeamCreate(Input):
    name: str = Field(min_length=1, max_length=100)


class Team(BaseModel):
    id: UUID
    name: str
    created_at: datetime


class StaffCreate(Input):
    profile_id: UUID
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)
    team_id: UUID | None = None


class StaffPatch(Input):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    team_id: UUID | None = None
    active: bool | None = Field(default=None, strict=True)

    @model_validator(mode='after')
    def nonempty(self):
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set - {'team_id'}):
            raise ValueError('Provide a staff change')
        return self


class Staff(BaseModel):
    profile_id: UUID
    email: str
    display_name: str
    team_id: UUID | None
    active: bool
    created_at: datetime


class Assignment(Input):
    assigned_staff_id: UUID | None = None
    assigned_team_id: UUID | None = None

    @model_validator(mode='after')
    def one_assignee(self):
        if (self.assigned_staff_id is None) == (self.assigned_team_id is None):
            raise ValueError('Choose one staff account or one team')
        return self


class TaskCreate(Assignment):
    ticket_id: str = Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')
    title: str = Field(min_length=1, max_length=200)
    instructions: str = Field(min_length=1, max_length=2000)
    priority: Literal['low', 'medium', 'high'] = 'medium'
    target_date: date


class Versioned(Input):
    expected_version: int = Field(ge=1, strict=True)


class TaskReassign(Assignment, Versioned):
    note: str = Field(min_length=1, max_length=2000)


class Progress(Versioned):
    notes: str = Field(min_length=1, max_length=2000)


class Blocker(Progress):
    blocker_type: Literal['parts', 'access', 'safety', 'other']


class Review(Versioned):
    decision: Literal['approve', 'rework']
    note: str = Field(min_length=1, max_length=2000, description='Internal staff review note.')
    public_note: str | None = Field(default=None, min_length=1, max_length=1000)
    repair_verified: bool = Field(default=False, strict=True)

    @model_validator(mode='after')
    def confirmed(self):
        if self.decision == 'approve' and (not self.repair_verified or not self.public_note):
            raise ValueError('Approval requires verified repair and a resident-visible note')
        if self.decision == 'rework' and self.repair_verified:
            raise ValueError('Rework cannot verify a repair')
        return self


class EvidenceInput(Progress):
    checked_on_site: Literal[True]


class Task(BaseModel):
    id: UUID
    ticket_id: str
    related_ticket_ids: list[str] = Field(default_factory=list)
    title: str
    description: str
    latitude: float
    longitude: float
    location_id: UUID | None = None
    location_name: str | None = None
    location_address: str | None = None
    location_storage: Literal['database','unavailable'] | None = None
    before_photo_url: str | None
    report_status: str
    assigned_staff_id: UUID | None
    assigned_team_id: UUID | None
    instructions: str
    priority: Literal['low', 'medium', 'high']
    target_date: date
    status: TaskStatus
    version: int = Field(ge=1, strict=True)
    work_notes: str
    completion_notes: str
    after_photo_url: str | None
    checked_on_site: bool
    review_note: str
    created_at: datetime
    updated_at: datetime


class TaskList(BaseModel):
    items: list[Task]
    limit: int
    offset: int
    has_more: bool


class StaffList(BaseModel):
    items: list[Staff]
    limit: int
    offset: int
    has_more: bool


class TeamList(BaseModel):
    items: list[Team]
    limit: int
    offset: int
    has_more: bool


class TaskEvent(BaseModel):
    id: int
    task_id: UUID
    action: str
    actor_id: UUID
    actor_role: Literal['management', 'maintenance']
    note: str
    created_at: datetime


class EventList(BaseModel):
    items: list[TaskEvent]
    limit: int
    offset: int
    has_more: bool


class StaffNotification(BaseModel):
    id: int
    task_id: UUID
    title: str
    message: str
    is_read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[StaffNotification]
    limit: int
    offset: int
    has_more: bool
