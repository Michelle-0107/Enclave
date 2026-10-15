# Registration schema review

The initial and post-application metadata snapshots supplied on 2026-10-14 were reviewed. The latter confirms seven application tables, the intended registration constraints, own-resident/profile policies, and restricted column/table grants. The user reports applying SQL 005 on 2026-10-15; an anonymous no-mutation probe confirms the transition RPC is recognized and denies client execution. No hosted SQL mutation was performed by the assistant. Full post-005 metadata and hosted backend-credential behavior remain unverified. Metadata is not a complete audit of every schema, view, role membership, Auth setting, or deployed backend.

## Initial snapshot findings

| Finding | Consequence | Registration decision |
| --- | --- | --- |
| Four inspected public tables: profiles, reports, notifications, categories. None of the six earlier proposal tables appears in the inspection. | The inspected registration table names are available as of this snapshot. | Use the three-table single-community proposal; do not run the archived six-table alternative. |
| profiles.id is a UUID primary key with a validated FK to auth.users.id. | It is a suitable account identifier for the new resident binding. | Keep the existing PK/FK and add residents.profile_id as a nullable unique FK. |
| All four tables have RLS enabled; policies is empty. | Ordinary client roles have no permitted SELECT/INSERT/UPDATE/DELETE rows. SELECT normally returns no rows; INSERT is rejected. Owner/service access can behave differently. | Add reviewed profile policies. Existing report ownership SQL is not reflected in this snapshot. |
| No non-internal triggers were returned for the inspected tables or auth.users; no public functions were returned. | The snapshot shows no automatic Auth-to-profile trigger. It does not prove profiles are empty or exclude backend-managed profile creation. | The new signup backend will explicitly insert a missing profile in its final application transaction. |
| profiles.role defaults to resident and permits resident or management; it is nullable. | The trusted management role value is management, not manager. Current missing policies deny ordinary row updates, but future ownership policies alone would not protect this column. | Restrict client updates to full_name only. Backend authorization requires the literal management value; null never grants management access. |
| anon and authenticated have all table privileges on all four tables, including TRUNCATE/TRIGGER/REFERENCES/MAINTAIN. | Grants are broader than needed. RLS protects row operations, not every whole-table operation. No conclusion is made that a client can already invoke those operations through the REST API. | Revoke unnecessary profile grants now in the registration SQL; separately review the three feature tables. |
| reports.user_id is nullable and defaults to gen_random_uuid(), while its FK targets profiles.id. | Omitting the owner can generate an unrelated UUID and violate the FK. The integrated API explicitly supplies the verified owner, so it does not depend on this default. | Plan removal of the random default and required-owner enforcement after checking legacy rows. Do not rewrite owners. |
| reports.ticket_id has no unique constraint and is nullable. | The API's lookup identifier is not guaranteed unique by the database. | Audit missing/duplicate values before adding a unique/non-null constraint. |
| reports.category references the unique categories.name with ON UPDATE CASCADE. | The current text category relation is valid. | Retain it for the current API; no category_id migration is needed for registration. |

## Files and application order

1. Review and apply [003_single_community_registration_draft.sql](sql/003_single_community_registration_draft.sql) to create the resident register, invitations, and OTP challenges. It fails rather than silently accepting an existing incompatible table.
2. Review and apply [004_profile_registration_access.sql](sql/004_profile_registration_access.sql) to give authenticated users access only to their own profile and only permit changing full_name. It leaves all profile rows and role values unchanged, keeps privileged backend access, and stops if unexpected profile columns/policies are present.
3. Rerun [inspect_registration_schema.sql](sql/inspect_registration_schema.sql) to confirm the intended new tables, grants, and policies. This is a metadata check, not a runtime RLS test.
4. The signup APIs and backend-only transitions are now implemented. SQL 005 is reported applied after 003/004, and anonymous RPC denial is verified. Configure the server using [REGISTRATION_HANDOFF.md](REGISTRATION_HANDOFF.md) and perform the explicit backend-credential check when the key is available. Installation creates no resident/Auth accounts.

The post-application metadata confirms: reference/email/profile binding uniqueness; shared unit numbers; composite invitation/challenge foreign keys; five-minute OTP expiry and five-attempt checks; one open invitation/challenge per resident; backend-only invitation/challenge grants; own-resident SELECT; and own-profile SELECT/full_name-only UPDATE. It contains no public transition functions yet. These findings supersede the initial table/policy absence for registration and profiles, while the feature-table findings remain outstanding.

The final signup transaction must ensure a profile exists for the authenticated UUID, create a missing one with role fixed to resident, bind the roster record, consume the invitation, and complete the challenge atomically. Preserve an existing profile's trusted role and verify its identity/email before reuse. Do not copy role from client input or user_metadata. A profile row alone does not establish verified residency.

No Auth trigger is added by this change. Accounts created outside the custom signup path still need a trusted profile provisioning/linking procedure. Do not automatically approve existing accounts as residents or bypass the management register.

## Feature-table work still required

This registration change does not open the other three tables. Before testing the integrated report API with a resident JWT, the database needs compatible ownership policies, a profile for that user, and matching category values. The existing `001_report_ownership.sql` supplies ownership policies but not resident eligibility enforcement. Its staging fixture script predates the now-confirmed profile/category foreign keys and must be updated before use.

Before resident-only launch, enforce active, verified resident binding in both backend authorization and report database policies. Notifications need owner-only reads and updates limited to is_read; their creation is a trusted backend operation. Categories can be read by signed-in users and maintained through trusted management operations. Feature-table grants should be reduced alongside those policies. Management review/status changes and the community map require their own explicit access rules.

No existing row counts, null values, duplicate tickets, roster contents, or category values were included in the snapshot. Data-dependent NOT NULL/UNIQUE changes need a separate read-only audit. Do not delete/reassign existing accounts, reports, or notifications to make a migration pass.

## Validation boundary

The 003/004/005 SQL and manual management-bootstrap safeguards execute successfully in a dedicated loopback PostgreSQL 17 database with synthetic Auth fixtures. Fifteen real SQL tests cover atomic profile/binding/invitation completion, persistent attempts, expiry/resend, retries, failed finalization recovery, role/RPC access denial, own-profile access, manager/duplicate/shared-unit rules, invitation replacement, shared rate counters, concurrent claims, stale-lease fencing, and trusted management initialization. API/provider/report/storage/root-entry-point and private setup/diagnostic tests also pass. Live Supabase Auth, Resend delivery, and hosted authenticated behavior still require integration testing; the anonymous probe alone does not prove RLS correctness. Report resident-eligibility enforcement remains a separate rollout requirement.

References: [PostgreSQL RLS and default deny](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Supabase column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security), [Supabase profile provisioning](https://supabase.com/docs/guides/auth/managing-user-data).
