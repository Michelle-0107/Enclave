"""Worker assignment checks happen in the same database transaction as writes."""
import io
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError

from .contracts import (Blocker, BlockerFeedback, EvidenceInput, EventList, NotificationList, Progress, Review,
    Staff, StaffCreate, StaffIdentity, StaffList, StaffPatch, Task, TaskCreate, TaskList,
    TaskReassign, TaskStatus, Team, TeamCreate, TeamList, Versioned)
from .repository import MaintenanceRejected, MaintenanceUnavailable
from ..reports.media import MediaUnavailable


def checked(model, value):
    try:
        return model.model_validate(value)
    except ValidationError:
        raise MaintenanceUnavailable() from None


async def photo_task(request, value):
    task = checked(Task, value)
    if not isinstance(value, Task):
        task = (await request.app.state.locations.labels([task]))[0]
    media = request.app.state.report_photo_links
    before = await run_in_threadpool(media.signed_image_url, task.before_photo_url)
    after = await run_in_threadpool(media.signed_image_url, task.after_photo_url)
    return task.model_copy(update={'before_photo_url': before, 'after_photo_url': after})


def create_router(authenticate):
    router = APIRouter(tags=['Maintenance'], responses={
        401: {'description': 'Missing, invalid or expired Supabase access token'},
        403: {'description': 'The database has not authorized this active staff account'},
        404: {'description': 'Record missing or not assigned to this worker/team'},
        409: {'description': 'Stale version or invalid workflow state; refresh before retrying'},
        503: {'description': 'Maintenance unavailable; confirm SQL 017 and storage configuration'},
    })

    @router.get('/api/v1/auth/role', response_model=StaffIdentity, tags=['Authentication'])
    async def identity(request: Request, response: Response, user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('identity', user.user_id)
        result = checked(StaffIdentity, data.get('identity'))
        if result.user_id != user.user_id:
            raise MaintenanceUnavailable()
        return result

    @router.post('/api/v1/management/maintenance/teams', response_model=Team, status_code=201)
    async def create_team(body: TeamCreate, request: Request, response: Response, user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('team_create', user.user_id, **body.model_dump(mode='json'))
        return checked(Team, data.get('team'))

    @router.get('/api/v1/management/maintenance/teams', response_model=TeamList)
    async def teams(request: Request, response: Response, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('team_list', user.user_id, limit=limit, offset=offset)
        return checked(TeamList, {**data, 'limit': limit, 'offset': offset})

    @router.post('/api/v1/management/maintenance/staff', response_model=Staff, status_code=201,
        description='Enable an existing confirmed Supabase Auth account as staff. Does not create passwords or send invitations. Registered residents and managers cannot be converted.')
    async def create_staff(body: StaffCreate, request: Request, response: Response, user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('staff_create', user.user_id, **body.model_dump(mode='json'))
        return checked(Staff, data.get('staff'))

    @router.patch('/api/v1/management/maintenance/staff/{profile_id}', response_model=Staff)
    async def update_staff(profile_id: UUID, body: StaffPatch, request: Request, response: Response, user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('staff_update', user.user_id, profile_id=str(profile_id), **body.model_dump(mode='json', exclude_unset=True))
        return checked(Staff, data.get('staff'))

    @router.get('/api/v1/management/maintenance/staff', response_model=StaffList)
    async def staff_list(request: Request, response: Response, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('staff_list', user.user_id, limit=limit, offset=offset)
        return checked(StaffList, {**data, 'limit': limit, 'offset': offset})

    @router.post('/api/v1/management/maintenance/tasks', response_model=Task, status_code=201)
    async def assign(body: TaskCreate, request: Request, response: Response, user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('task_create', user.user_id, **body.model_dump(mode='json'))
        return await photo_task(request, data.get('task'))

    async def list_tasks(action, request, response, user, status, limit, offset):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call(action, user.user_id, status=status, limit=limit, offset=offset)
        result = checked(TaskList, {**data, 'limit': limit, 'offset': offset})
        if len(result.items) > limit:
            raise MaintenanceUnavailable()
        result.items = await request.app.state.locations.labels(result.items)
        result.items = [await photo_task(request, item) for item in result.items]
        return result

    @router.get('/api/v1/maintenance/tasks', response_model=TaskList)
    async def my_tasks(request: Request, response: Response, status: TaskStatus | None = None,
        limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), user=Depends(authenticate)):
        return await list_tasks('task_list', request, response, user, status, limit, offset)

    @router.get('/api/v1/management/maintenance/tasks', response_model=TaskList)
    async def management_tasks(request: Request, response: Response, status: TaskStatus | None = None,
        limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), user=Depends(authenticate)):
        return await list_tasks('management_list', request, response, user, status, limit, offset)

    @router.get('/api/v1/maintenance/tasks/{task_id}', response_model=Task)
    @router.get('/api/v1/management/maintenance/tasks/{task_id}', response_model=Task)
    async def task(task_id: UUID, request: Request, response: Response, user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        action = 'management_get' if '/management/' in request.url.path else 'task_get'
        data = await request.app.state.maintenance.call(action, user.user_id, task_id=str(task_id))
        return await photo_task(request, data.get('task'))

    @router.get('/api/v1/maintenance/tasks/{task_id}/history', response_model=EventList)
    @router.get('/api/v1/management/maintenance/tasks/{task_id}/history', response_model=EventList)
    async def history(task_id: UUID, request: Request, response: Response, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        action = 'management_history' if '/management/' in request.url.path else 'task_history'
        data = await request.app.state.maintenance.call(action, user.user_id, task_id=str(task_id), limit=limit, offset=offset)
        return checked(EventList, {**data, 'limit': limit, 'offset': offset})

    async def change(action, task_id, body, request, response, user):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call(action, user.user_id, task_id=str(task_id), **body.model_dump(mode='json'))
        return await photo_task(request, data.get('task'))

    @router.post('/api/v1/maintenance/tasks/{task_id}/start', response_model=Task)
    async def start(task_id: UUID, body: Versioned, request: Request, response: Response, user=Depends(authenticate)):
        return await change('task_start', task_id, body, request, response, user)

    @router.patch('/api/v1/maintenance/tasks/{task_id}/progress', response_model=Task)
    async def progress(task_id: UUID, body: Progress, request: Request, response: Response, user=Depends(authenticate)):
        return await change('task_progress', task_id, body, request, response, user)

    @router.post('/api/v1/maintenance/tasks/{task_id}/blockers', response_model=Task)
    async def blocker(task_id: UUID, body: Blocker, request: Request, response: Response, user=Depends(authenticate)):
        return await change('task_blocker', task_id, body, request, response, user)

    @router.post('/api/v1/management/maintenance/tasks/{task_id}/blocker-feedback', response_model=Task)
    async def blocker_feedback(task_id: UUID, body: BlockerFeedback, request: Request, response: Response, user=Depends(authenticate)):
        return await change('task_blocker_feedback', task_id, body, request, response, user)

    @router.patch('/api/v1/management/maintenance/tasks/{task_id}/assignment', response_model=Task)
    async def reassign(task_id: UUID, body: TaskReassign, request: Request, response: Response, user=Depends(authenticate)):
        return await change('task_reassign', task_id, body, request, response, user)

    @router.post('/api/v1/management/maintenance/tasks/{task_id}/review', response_model=Task)
    async def review(task_id: UUID, body: Review, request: Request, response: Response, user=Depends(authenticate)):
        return await change('task_review', task_id, body, request, response, user)

    @router.post('/api/v1/maintenance/tasks/{task_id}/evidence', response_model=Task,
        description='Multipart JPEG/PNG up to 10 MiB. Authorization/version checked before upload and again at commit. Evidence awaits management review.')
    async def evidence(task_id: UUID, request: Request, response: Response,
        expected_version: int = Form(..., ge=1), notes: str = Form(..., min_length=1, max_length=2000),
        checked_on_site: bool = Form(...), file: UploadFile = File(...), user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        try:
            body = EvidenceInput(expected_version=expected_version, notes=notes, checked_on_site=checked_on_site)
        except ValidationError:
            raise HTTPException(422, 'Completion notes and an on-site check are required') from None
        if set(await request.form()) - {'expected_version', 'notes', 'checked_on_site', 'file'}:
            raise HTTPException(422, 'Unexpected evidence form field')
        repository = request.app.state.maintenance
        values = {'task_id': str(task_id), **body.model_dump(mode='json')}
        await repository.call('evidence_access', user.user_id, **values)
        extension = {'image/jpeg': 'jpg', 'image/png': 'png'}.get(file.content_type)
        if extension is None:
            raise HTTPException(415, 'Use a JPEG or PNG photo')
        content = await file.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(413, 'Photo exceeds the 10 MiB limit')
        try:
            from PIL import Image
            with Image.open(io.BytesIO(content)) as image:
                if image.format != ('JPEG' if extension == 'jpg' else 'PNG') or image.width * image.height > 25_000_000:
                    raise ValueError()
                image.verify()
        except Exception:
            raise HTTPException(415, 'Provide a valid JPEG or PNG photo, up to 25 megapixels') from None
        media = request.app.state.media
        try:
            url = await run_in_threadpool(media.upload, f'maintenance/{task_id}/{uuid4().hex}.{extension}', content, file.content_type)
        except MediaUnavailable:
            raise HTTPException(503, 'Photo storage unavailable') from None
        try:
            data = await repository.call('task_evidence', user.user_id, **values, photo_url=url)
        except MaintenanceRejected:
            # A confirmed rejection did not commit. Ambiguous transport failures
            # retain the object because the evidence transaction may have committed.
            await run_in_threadpool(media.delete_report_images, [url])
            raise
        return await photo_task(request, data.get('task'))

    @router.get('/api/v1/maintenance/notifications', response_model=NotificationList)
    async def notifications(request: Request, response: Response, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        data = await request.app.state.maintenance.call('notifications', user.user_id, limit=limit, offset=offset)
        return checked(NotificationList, {**data, 'limit': limit, 'offset': offset})

    @router.post('/api/v1/maintenance/notifications/{notification_id}/read', status_code=204)
    async def notification_read(notification_id: int, request: Request, response: Response, user=Depends(authenticate)):
        response.headers['Cache-Control'] = 'private, no-store'
        if notification_id < 1:
            raise HTTPException(422, 'Invalid notification ID')
        await request.app.state.maintenance.call('notification_read', user.user_id, notification_id=notification_id)
        response.status_code = 204
        return response

    return router
