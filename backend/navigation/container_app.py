"""Container entry point: start a loopback engine before serving the protected API."""

import asyncio
from contextlib import asynccontextmanager, contextmanager
import logging

from fastapi.responses import JSONResponse
import uvicorn

from ..app import create_app
from .config import NavigationSettings


logger = logging.getLogger(__name__)


class PrivateEngineServer(uvicorn.Server):
    """The outer API server owns SIGTERM/SIGINT and invokes this server's shutdown."""

    @contextmanager
    def capture_signals(self):
        yield

    def install_signal_handlers(self):
        # Compatibility with Uvicorn releases that predate capture_signals.
        return None


async def wait_for_engine(server, task, timeout):
    try:
        async with asyncio.timeout(timeout):
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError('Private routing engine stopped before startup completed')
                await asyncio.sleep(0.05)
    except TimeoutError:
        raise RuntimeError('Private routing engine did not become ready before the startup deadline') from None


async def stop_engine(server, task, timeout):
    server.should_exit = True
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
    except TimeoutError:
        server.force_exit = True
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    except (Exception, asyncio.CancelledError):
        # Startup/runtime failure is logged separately; always finish API client cleanup.
        pass


def create_container_app(settings=None, *, engine_port=8002, engine_application=None,
                         startup_timeout=30, shutdown_timeout=10, **app_options):
    """Factory arguments are trusted server/test configuration, never API inputs.

    The normal local main:app entry point remains independent. Docker uses this
    application so a fresh container does not depend on an engine on a developer PC.
    Graph/package preparation is a build-time step, with no runtime pip/downloads.
    """
    if type(engine_port) is not int or not 1 <= engine_port <= 65535:
        raise ValueError('Use a valid private engine port')
    if 'navigation_settings' in app_options:
        raise ValueError('Container routing uses its owned loopback engine')
    if engine_application is None:
        from .engine import app as engine_application
    application = create_app(settings, navigation_settings=NavigationSettings(
        provider_url=f'http://127.0.0.1:{engine_port}'), **app_options)
    original_lifespan = application.router.lifespan_context

    @asynccontextmanager
    async def lifespan(api):
        server = PrivateEngineServer(uvicorn.Config(engine_application, host='127.0.0.1', port=engine_port,
            lifespan='on', access_log=False, log_config=None, timeout_graceful_shutdown=5))
        api.state.private_engine_server = server
        api.state.private_engine_ready = False

        async def run_engine():
            try:
                await server.serve()
            except SystemExit:
                raise RuntimeError('Private routing engine could not start; check its build/runtime logs') from None

        task = asyncio.create_task(run_engine())
        api.state.private_engine_task = task
        def ended(finished):
            api.state.private_engine_ready = False
            if not server.should_exit:
                # No exception bodies, request inputs or environment values are logged.
                logger.error('Private routing engine stopped unexpectedly; API readiness is unavailable.')
            if not finished.cancelled():
                finished.exception()  # Retrieve failure without exposing sensitive exception text.
        task.add_done_callback(ended)
        try:
            await wait_for_engine(server, task, startup_timeout)
            api.state.private_engine_ready = True
            # Startup is not reported successful until both the engine and API are ready.
            async with original_lifespan(api):
                yield
        finally:
            api.state.private_engine_ready = False
            await stop_engine(server, task, shutdown_timeout)

    application.router.lifespan_context = lifespan

    @application.middleware('http')
    async def engine_health(request, call_next):
        if request.url.path == '/health':
            server = getattr(application.state, 'private_engine_server', None)
            ready = getattr(application.state, 'private_engine_ready', False)
            if not ready or server is None or server.should_exit:
                return JSONResponse(status_code=503, content={'status': 'unavailable', 'dependency': 'routing_engine'},
                                    headers={'Cache-Control': 'no-store'})
        return await call_next(request)

    return application


app = create_container_app()
