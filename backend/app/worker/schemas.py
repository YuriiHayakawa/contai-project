"""Respostas do endpoint interno do worker."""

from pydantic import BaseModel

from app.worker.main import TaskStatus


class ScheduledTaskRead(BaseModel):
    name: str
    status: TaskStatus


class ScheduledTasksRead(BaseModel):
    tasks: list[ScheduledTaskRead]
