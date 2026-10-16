# Enclave backend layout

The backend is grouped by responsibility. Only the application entry point,
package marker, and this guide sit at the top level.

```text
backend/
  __init__.py
  app.py
  README.md
  core/
    __init__.py
    auth.py                 Supabase JWT verification
    config.py               Root environment loading and validation
  reports/
    __init__.py
    models.py               Report and current-user response contracts
    repository.py           Owner-scoped Supabase persistence
    media.py                S3 upload and existing Bedrock/Gemini integration
    map.py                  Shared GeoJSON and geographic bounds
    issues.py               Explicit facility/incident grouping and two-resident counting
    community_demo.py       Two-resident sandbox with real local routing
    map_demo.py             Isolated synthetic map practice
    moderation.py           Management review and report history
    workflow_demo.py        Isolated report review practice
  navigation/               KL East walking directions, contracts, local engine, and road snapshot
  registration/
    __init__.py
    contracts.py            Signup, invitation, and residency contracts
    settings.py             Registration settings and Resend sender
    clients.py              Supabase Auth and transition RPC clients
    service.py              Invitation and OTP orchestration
    residents.py            Active, verified residency checks
    demo.py                 Isolated local signup practice
  routers/                  Existing team routers
  services/                 Existing team services
  tools/                    Developer commands
  tests/                    Backend regression tests
  sql/                      Migrations, inspections, and repair scripts
  docs/                     API contracts and registration handoff
  local/                    Separate SQLite practice backend
```

## Environment and commands

Run commands from the repository root. The private `.env` remains there,
using exactly the team's ten agreed variable names. No extra env file is needed.

```powershell
python -m uvicorn main:app --reload --port 8001
python -B -m backend.tools.check_registration
python -B -m backend.tools.check_session --port 8001 --show-token
python -B -m backend.tools.check_storage
python -B -m backend.registration.demo
python -B -m backend.reports.map_demo
python -B -m backend.reports.workflow_demo
python -B -m unittest -q backend.tests.test_report_workflow backend.tests.test_map backend.tests.test_cloud backend.tests.test_entrypoint backend.tests.test_registration backend.tests.test_registration_setup backend.tests.test_storage
```

The signup demo uses synthetic accounts/email. Live integration requires the
configured providers. The SQLite application in `local/` remains independent.

## Integration boundaries

The protected report endpoint uses `reports/media.py`. The team's separate image
analyzer remains in `services/reports_service.py`; this layout change does not
combine the analyzers or change their behavior.

The only teammate-file edits for this layout are three approved import-path
updates: two in `routers/email.py` and one in `services/email_service.py`.
The former `registration_config` and `registration_models` wrappers are no
longer needed; imports now reference `registration/settings.py` and
`registration/contracts.py` directly.

Community map contract and practice: [COMMUNITY_MAP_TESTING.md](docs/api/COMMUNITY_MAP_TESTING.md).

Management review contract and practice: [REPORT_WORKFLOW_TESTING.md](docs/api/REPORT_WORKFLOW_TESTING.md).

KL East directions and local engine: [NAVIGATION_TESTING.md](docs/api/NAVIGATION_TESTING.md).

Historical obstacle guide (superseded by SQL 009): [OBSTACLE_ROUTING_TESTING.md](docs/api/OBSTACLE_ROUTING_TESTING.md).

Current two-resident map and three route modes: [COMMUNITY_ROUTES_TESTING.md](docs/api/COMMUNITY_ROUTES_TESTING.md).
