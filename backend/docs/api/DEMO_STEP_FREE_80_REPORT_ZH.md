# Demo step-free route：冻结 480 samples 验收

日期：2026-10-20（Asia/Kuala_Lumpur）。本记录说明本地实现与 audit 结果；Git commit / push 不代表生产环境已部署。

## 验收结果

**470 / 480 = 97.92%；16 个 area × category × batch 分组全部 ≥80%，最低 26/30 = 86.67%。**

用户确认沿用原 480 个 walking-eligible samples：两个地区、四个分类、primary / holdout，每组 30 个；overall 及每组至少 80%。没有删掉失败案例、重抽点、修改 seeds 或扩大 service-area endpoint bounds。

| Batch | Area | Cross road | Same side | Local streets | Long distance |
|---|---|---:|---:|---:|---:|
| walking-primary | kl-east-pilot | 29/30 (96.67%) | 30/30 (100.00%) | 29/30 (96.67%) | 29/30 (96.67%) |
| walking-primary | kajang-prima-saujana | 30/30 (100.00%) | 30/30 (100.00%) | 30/30 (100.00%) | 30/30 (100.00%) |
| walking-holdout | kl-east-pilot | 29/30 (96.67%) | 30/30 (100.00%) | 26/30 (86.67%) | 28/30 (93.33%) |
| walking-holdout | kajang-prima-saujana | 30/30 (100.00%) | 30/30 (100.00%) | 30/30 (100.00%) | 30/30 (100.00%) |

修改前 baseline：122/480 = 25.42%。第一轮没有 registered building entrances 时为 450/480 = 93.75%，但 Prima holdout cross road 只有 22/30，因此该轮判定失败；完整结果另存 `demo-step-free-audit/attempt-1-no-building-entrances/`。

## 路由规则与 simulated facilities

- Resident Demo 的 `accessible` option / Wheelchair profile 使用独立的 `demo_step_free_graph`。Live 的 field-verified network 与普通 walking graph 不加入这些虚构设施。
- 按 OSM road geometry 和既有 geographic crossing anchors 生成 dropped-kerb crossings / lift-access footbridges；不用 audit endpoints、seeds 或结果作为 placement 输入。
- 为原有短连接生成 hypothetical paved ramps，仅连接原本分离的 recorded-road components；单段室外补接及 endpoint approach 最多 20m。Dijkstra 先最小化这些补接长度，再最小化真实行走距离，因此优先沿已有道路绕行。
- 每栋 service window 内符合条件的 mapped building，选择最近可接入 ground path 的 boundary entrance；outdoor entrance ramp 最多 20m，并检查其他建筑、水域、wall/fence 和 road-crossing policy。building 内到固定 entrance 的移动是明确的 demo step-free assumption，不编造室内 floor plan 或室内 directions；室内距离不会算作已知 outdoor route length。
- stairs、标为非 step-free 的 OSM ways、active damage zones 仍不可通行；没有 registered entrance 的 building 仍返回 unavailable。固定入口不能为了绕过 damage 而移动。
- 每个虚构设施有稳定 ID、精确 graph geometry、`routingSource=simulation`、`fieldVerified=false`、`stepFree=true` 和具体 `accessFeatures`。启动时验证 checked-in manifest 能由 geographic generator 重建。
- App 选中 step-free route 后默认只显示该路线使用的 teal `SF` markers，其他 markers 仍隐藏。`Show facility markers` 可以查看全部。路线指引区分 dropped kerbs、lift bridges、ramps 和 building entrances；UI 使用 `Demo step-free route`，不标为 verified。

| Area | Dropped-kerb crossing segments | Lift bridge segments | Ramp connectors | Building entrances | Total |
|---|---:|---:|---:|---:|---:|
| kl-east-pilot | 1774 | 202 | 333 | 1158 | 3467 |
| kajang-prima-saujana | 1939 | 78 | 263 | 214 | 2494 |

上述计数为 manifest graph segments / entrance records，不是实际存在的设施或独立已勘察的建筑入口数量。普通道路、路面坡度和室内可达性仍是 demo assumptions；97.92% 是这批固定 samples 的模拟 route availability，不是现实 wheelchair safety 或所有地点必达的保证。

## 全部失败案例（10 个，保留在分母中）

| Batch | ID | Reason |
|---|---|---|
| walking-primary | kl-east-pilot-cross_road-19 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| walking-primary | kl-east-pilot-local_streets-24 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| walking-primary | kl-east-pilot-long_distance-27 | No simulated step-free entrance is registered for this building. |
| walking-holdout | kl-east-pilot-cross_road-30 | No connected walking route meets the road-crossing rules. Private local roads may be crossed under the resident policy; other roads require a mapped crossing, footbridge or underpass. Try another access point. |
| walking-holdout | kl-east-pilot-local_streets-05 | No connected walking route meets the road-crossing rules. Private local roads may be crossed under the resident policy; other roads require a mapped crossing, footbridge or underpass. Try another access point. |
| walking-holdout | kl-east-pilot-local_streets-10 | No connected walking route meets the road-crossing rules. Private local roads may be crossed under the resident policy; other roads require a mapped crossing, footbridge or underpass. Try another access point. |
| walking-holdout | kl-east-pilot-local_streets-19 | No connected walking route meets the road-crossing rules. Private local roads may be crossed under the resident policy; other roads require a mapped crossing, footbridge or underpass. Try another access point. |
| walking-holdout | kl-east-pilot-local_streets-21 | No connected walking route meets the road-crossing rules. Private local roads may be crossed under the resident policy; other roads require a mapped crossing, footbridge or underpass. Try another access point. |
| walking-holdout | kl-east-pilot-long_distance-24 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| walking-holdout | kl-east-pilot-long_distance-27 | A walking approach intersects a reported damaged area; choose another access point. |

## 可复现证据

- `demo-step-free-audit/summary.json`：分组成绩、验收 gate、sample SHA256、算法 SHA256。
- `demo-step-free-audit/walking-primary.json.gz` / `walking-holdout.json.gz`：全部 480 个原始坐标、成功/失败、失败原因；成功路线另外保存 geometry、maneuvers、facility IDs、warnings、snap distances 和 duration。
- `demo-step-free-audit/baseline-before-step-free.json.gz`：修改前全部 480 个结果，逐点核对与当前坐标相同。
- `demo-step-free-audit/attempt-1-no-building-entrances/`：首轮未达标的完整 audit，未覆盖或隐藏。

原 fixtures SHA256（统一 LF 后）：

```text
walking-primary: c741d589985b40954a484b03a69fedc291c71619eb68f2245942da016cb43ef8
walking-holdout: df1e904cf559171f1e2c9837950314ff3e7f862238890e8b0af7f2d3222a2f2e
```

重新生成 simulated facilities 与 routing caches：

```powershell
.\.venv\Scripts\python.exe -m backend.tools.build_demo_accessibility
```

重跑原 480 个 app-level requests：

```powershell
.\.venv\Scripts\python.exe -m backend.tools.audit_demo_accessibility
```

`audit_demo_accessibility` 任何一组低于 80%、missing group、sample hash 变化或总数不是 480 都会失败；不会用 walking fallback 替代 Wheelchair。生成器无需 SQL migration，也不会创建真实 reports / facilities。

## Regression checks

- Backend：86 tests 全部通过，覆盖新增 step-free 480-sample gate、原 walking >=95% gate、旧随机与独立 facility audits、cache/source signature、Live isolation、damage、stairs、physical barriers、20m limit 和道路绕行优先。
- Mobile：TypeScript typecheck、ESLint、29 screen checks、21 network checks、8 demo service-area checks、6 Live service-area checks 通过。
- 未执行 cloud build、生产 SQL migration 或部署；本地 device UI 尚未实机验证。
