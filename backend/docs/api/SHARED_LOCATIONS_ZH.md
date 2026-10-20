# Shared map locations

## 目标与范围

`public.map_locations` 是 resident navigation、report、management、maintenance 和 What-if 共用的地点 registry。界面以名称为主，地图及 routing 保留 numeric coordinates。当前 seed 有 1,252 个 OSM place/address records（KL East + Prima Saujana），以及上一项工作生成的 2,072 个 KL East road-section report points；另同步现有 community facilities。所有已知地点都存入 database，但 OSM 没有收录的真实地点不会凭空获得地址或名称。

每条 location 保留 stable UUID、area、name、address、latitude、longitude、kind、source、position_basis、metadata 和 active state。Road metadata 包含原 OSM way、约 100m section geometry、length、index、未实地验证标记及 source timestamp。Location record 不代表道路可以通行或符合 wheelchair accessibility。

`map_places` 保留给旧版本兼容及旧数据导入；当前客户端直接查询 registry。旧 `search_map_places` RPC 也改读 registry。现有 `community_facilities` 仍承担 incident grouping 的 domain record，由 trigger 自动同步名称和位置至 registry，首次 report materialize 一个 section 时复用相同 UUID。不是把一整条路上的问题合并成一个 incident。

## 各端行为

- Resident Live/Demo navigation：地点搜索读 shared API，搜索结果名称和坐标来自同一个 record；map-picked endpoints 显示 nearby place name。实际选点、私人 saved place 和 routing endpoint 不会被 reverse lookup 自动移动。
- Resident report：可以搜索 place、road 和 section，再在地图核对实际问题位置；nearby section list 从 registry 读 geometry。提交 `location_id` 和实际 photo pin；section/facility 仍需 resident 明确选择。Report preview 和 My reports/details 使用地点名称。
- Management reports 与 maintenance tasks：backend 在原 ownership/role/assignment checks 成功后，batch 加载 report 的 location reference/name/address。列表和详情以名称为主；地图的 coordinates 收进可展开 details。Maintenance 始终引用原 report 的地点。
- What-if：A/B 可按名称查地点，map click/drag 自动显示附近地点；手动 coordinates 放进展开区。Candidate facility names 从 registry 读取；原 two-distinct-resident threshold、pending approval policy、approval queue 和 routing algorithm 均保留。

## Report reference 与数据保护

`reports` 新增 `location_id` FK、`location_name`、`location_address`。Insert/位置变更由 database trigger 查出 canonical record 并保存名称 snapshot，忽略客户端伪造的名称。明确选择的 ID 必须 active 且距离实际 pin 不超过 100m；没有 ID 时只在 100m 内找最近 reference。超过 1m 的 lookup 显示 `Near <name> (<distance> m)`，不是精确门牌地址。找不到时显示 `Selected map point`，详情仍有真实坐标。

关联 community issue 后，report reference 指向所选 facility/section，而不是被附近别的地点替代。照片位置不动。后续 approval/status update 不重写原名称 snapshot；历史 reports 在 seed migration 中 backfill。旧记录若没有足够位置资料，保留未命名状态。

只有 backend service role 能读写 registry/RPC；公开 HTTP lookup 必须有有效 JWT，SQL 再检查 active verified resident、management profile 或 active maintenance staff。浏览器不能指定 actor 身份、修改地点、执行 internal label lookup。Report/task label lookup 只在原记录授权成功后调用，location table 不保存 report 内容、reporter identity、private saved pins 或 GPS history。`user_saved_places` 的私人 RLS 不变。

## API

`GET /api/v1/locations?area_id=kl-east-pilot&q=KL%20East%20Mall&limit=8`

`GET /api/v1/locations?area_id=kl-east-pilot&latitude=3.22649&longitude=101.730755&limit=1`

Search 2–160 characters，按 name/address token 匹配；nearby 范围 100m；limit 1–100，offset 分页。返回 `area_id, items, storage=database, limit, offset, has_more, attribution`。Place 有 `kind`、`distance_meters` 和 provenance；坐标为 longitude/latitude numeric fields。未安装新 migration 的直接 location API 返回 503，不伪装 database results。

旧 `/navigation/areas/{id}/places` 仅为旧 app 保留 compatibility fallback。Road-section endpoint 在 SQL 020 未安装时可继续读 bundled section catalogue，`X-Enclave-Location-Storage` 明确区分来源；新版本提交带 location_id，必须先完成 SQL rollout。读取既有 reports/tasks 遇到 registry outage 会保留已授权记录，返回 `location_storage=unavailable`，可以查看 pin 并重试。

## Rollout（本次尚未对 production 执行）

1. 确认既有 SQL 009、015、017、018 已安装；若没有 `map_places`，先执行 `015_map_places.sql`。021 已包含 place seed，不必重复 016。
2. 执行 `019_road_section_reporting.sql`（上一项 section grouping 功能）。
3. 执行 `020_shared_map_locations.sql`（table、FK、private lookup、sync/backfill triggers、兼容 search、What-if name projection）。
4. 在 SQL Editor **分三次**依次执行 `021_shared_map_locations_seed.sql`、`021b_shared_map_locations_seed.sql`、`021c_shared_map_locations_finalize.sql`；每次清空 Editor 后粘贴下一份，不能把三份合并执行。前两份导入全部地点及 road points，最后一份验证 3,324 个 seed IDs 完整后才执行历史 report label backfill。020 与所有 021 parts 均可重复执行，stable IDs 不变；seed 不覆盖人工更改的现有名称或位置。若将来重跑 018，需要再应用 020。
5. 部署 backend、web 和 mobile JavaScript。没有新增 native module，不需要为本次功能消耗 Expo cloud build。

验证 SQL：

```sql
SELECT kind, count(*) FROM public.map_locations WHERE active GROUP BY kind;
-- 基础 seed: place 1252, road_section 2072；facility 数量取决于实际已有资料。
SELECT ticket_id, location_id, location_name, latitude, longitude
FROM public.reports ORDER BY created_at DESC LIMIT 10;
```

生成 seed（offline，不接 database）：

```powershell
.venv\Scripts\python.exe -m backend.tools.build_road_report_points
.venv\Scripts\python.exe -m backend.tools.build_location_seed
.venv\Scripts\python.exe -m backend.tools.export_openapi
```

新增/更改 service area 时需要同步 SQL area classifier 和 backend area registry；当前 Prima Saujana 的地点可以搜索/导航，但不因此开启原本未支持的 community reporting。OSM source 更新造成 section IDs/geometry 改变时，需另行审核历史关联；不能依名称或 proximity 合并旧 incidents。

Source attribution: OpenStreetMap contributors, ODbL-1.0。参考坐标可能是 building/way centre，不是经过验证的入口。

## Validation

独立 local PostgreSQL tests 验证 full seed、idempotency、RLS/private grants、resident/management/maintenance access、HTTP actor spoofing、road geometry、exact pin preservation、snapshot、防止远距离 location_id、facility sync、section 独立计数和 What-if pending approval 保持正确。Repository tests 验证 batch/area/NaN/outage。Mobile 和 web typecheck/lint 及既有 report upload、search、navigation、maintenance、candidate approval regression 已运行；无真实 report/approval 写入，无 production SQL、deploy、APK build 或 push。

### SQL Editor query size 修复

原单份 021 为 1,781,339 UTF-8 bytes，会超过 Supabase Studio 的 `0.98 * MB` guard。Generator 现在把每份 SQL（含 SQL wrapper）限制为 900,000 bytes 以下，并由 regression test 检查。官方实现：<https://github.com/supabase/supabase/blob/master/apps/studio/data/sql/execute-sql-mutation.ts>。

如果前一份失败，停在该份，解决后重跑该份及后续文件即可，不用重跑 019/020。若 finalize 提示 incomplete，先补跑两份 seed，再运行 finalize。每份独立 transaction；finalize 失败时在 Editor 新 query 执行 `ROLLBACK;` 后重试。已经成功执行旧版完整 021 的 database 也可安全运行这些分片，保持 IDs 与报告关联，不会重复创建地点。
