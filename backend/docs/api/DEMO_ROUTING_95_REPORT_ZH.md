# Routing 95% audit

**95% acceptance: PASS.**

Walking-eligible total: **477/480 (99.38%)**。

总体必须 >95%；每个 area × category × batch 及每类 facility 专项分别 >=95%。30-case group 至少29/30。

## Scope and sampling

- 原240 primary +240 holdout coordinates 完全保留，按实际 route success 计分。旧 baseline report/raw results 保留在 `DEMO_ROUTING_RANDOM_REPORT_ZH.md` / `demo-routing-audit/`，本次 rerun 另存 `demo-routing-audit-95/`。
- 经用户确认，95% acceptance 使用 walking-eligible primary / holdout，seed20261022 /20261023，每个 area 四类各30，共480条。两批 samples 在首次计算 route success 前冻结。
- Eligibility：两端在 service window 内，来自 mapped walking/roadside coverage；cross-road 仅取有 walking coverage 的道路。两端分别满足20m outdoor / nearest-building access；排除已知 endpoint physical obstacles。
- 不按 connected component 或 route success 筛选，不删除/替换失败，不换 seed 找高分。
- Cross-road 在道路中心线两侧各8m；local streets 两条不同住宅/服务道路，直线50–500m；long distance 直线至少800m；same-side 取同侧道路。
- Facility 专项沿用 seed20261021 的原 samples，指定 facility ID 必须出现在实际返回 route 中。
- 本地 Demo audit 不等于 Live availability、实地通行或 accessibility certification。

## Routing policy

- 固定 endpoint access，优先 recorded roads/footpaths/facilities；只有无法连通时使用 <=20m inferred links。fallback 中先比较 inferred distance，再比较实际 walk distance。
- 不穿 building/fence/water 或无授权 road crossing。Building endpoint 仍关联最近可接入道路，不设任意距离上限。
- 允许沿 OSM extract buffer 内的 recorded roads 绕行，endpoint service window 不扩大。Mapped road bridge 仅在真实共享 OSM approach node 连接同侧 grade transition；2D交叉不能连接上下层。
- Demo facilities 与 Live graph 隔离；推定和虚构通道保留明确 warnings。
- 用户明确确认 trunk roadside policy：仅接纳 access=yes 且没有 foot=no/use_sidepath 或 motorroad=yes 的 trunk；motorway、motorway_link、trunk_link 不因此开放。仍禁止无设施横穿。
- 本次沿用原 OSM extracts，没有采用临时下载的新地图。Demo-only buffer crossings 按统一75m geographic spacing 补充，旧 facility IDs 保留；不是20m open-land links，也不进入 Live。

## Walking-eligible results

| Batch | Area | Category | Success | Rate |
|---|---|---|---:|---:|
| walking-primary | kajang-prima-saujana | cross_road | 30/30 | 100.00% |
| walking-primary | kajang-prima-saujana | local_streets | 30/30 | 100.00% |
| walking-primary | kajang-prima-saujana | long_distance | 30/30 | 100.00% |
| walking-primary | kajang-prima-saujana | same_side | 30/30 | 100.00% |
| walking-primary | kl-east-pilot | cross_road | 29/30 | 96.67% |
| walking-primary | kl-east-pilot | local_streets | 29/30 | 96.67% |
| walking-primary | kl-east-pilot | long_distance | 30/30 | 100.00% |
| walking-primary | kl-east-pilot | same_side | 30/30 | 100.00% |
| walking-holdout | kajang-prima-saujana | cross_road | 30/30 | 100.00% |
| walking-holdout | kajang-prima-saujana | local_streets | 30/30 | 100.00% |
| walking-holdout | kajang-prima-saujana | long_distance | 30/30 | 100.00% |
| walking-holdout | kajang-prima-saujana | same_side | 30/30 | 100.00% |
| walking-holdout | kl-east-pilot | cross_road | 30/30 | 100.00% |
| walking-holdout | kl-east-pilot | local_streets | 30/30 | 100.00% |
| walking-holdout | kl-east-pilot | long_distance | 29/30 | 96.67% |
| walking-holdout | kl-east-pilot | same_side | 30/30 | 100.00% |

## Original 480 rerun

| Batch | Area | Category | Success | Rate |
|---|---|---|---:|---:|
| random-primary | kajang-prima-saujana | cross_road | 30/30 | 100.00% |
| random-primary | kajang-prima-saujana | local_streets | 30/30 | 100.00% |
| random-primary | kajang-prima-saujana | long_distance | 30/30 | 100.00% |
| random-primary | kajang-prima-saujana | same_side | 30/30 | 100.00% |
| random-primary | kl-east-pilot | cross_road | 26/30 | 86.67% |
| random-primary | kl-east-pilot | local_streets | 30/30 | 100.00% |
| random-primary | kl-east-pilot | long_distance | 29/30 | 96.67% |
| random-primary | kl-east-pilot | same_side | 30/30 | 100.00% |
| random-holdout | kajang-prima-saujana | cross_road | 29/30 | 96.67% |
| random-holdout | kajang-prima-saujana | local_streets | 30/30 | 100.00% |
| random-holdout | kajang-prima-saujana | long_distance | 30/30 | 100.00% |
| random-holdout | kajang-prima-saujana | same_side | 30/30 | 100.00% |
| random-holdout | kl-east-pilot | cross_road | 26/30 | 86.67% |
| random-holdout | kl-east-pilot | local_streets | 30/30 | 100.00% |
| random-holdout | kl-east-pilot | long_distance | 30/30 | 100.00% |
| random-holdout | kl-east-pilot | same_side | 30/30 | 100.00% |

## Facility results

| Batch | Area | Category | Success | Rate |
|---|---|---|---:|---:|
| facilities | kajang-prima-saujana | simulation_crossing | 30/30 | 100.00% |
| facilities | kajang-prima-saujana | simulation_footbridge | 30/30 | 100.00% |
| facilities | kl-east-pilot | openstreetmap_crossing | 27/27 | 100.00% |
| facilities | kl-east-pilot | openstreetmap_footbridge | 10/10 | 100.00% |
| facilities | kl-east-pilot | simulation_crossing | 30/30 | 100.00% |
| facilities | kl-east-pilot | simulation_footbridge | 29/30 | 96.67% |

原480 rerun 总体：**470/480 (97.92%)**。Motorway/trunk 附近无法满足 access rules 的点仍记失败，没有改算成功。

## Retained failures

| Batch | Case | Reason |
|---|---|---|
| random-primary | kl-east-pilot-cross_road-19 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| random-primary | kl-east-pilot-cross_road-20 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| random-primary | kl-east-pilot-cross_road-27 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| random-primary | kl-east-pilot-cross_road-29 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| random-primary | kl-east-pilot-long_distance-27 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| random-holdout | kl-east-pilot-cross_road-04 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| random-holdout | kl-east-pilot-cross_road-10 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| random-holdout | kl-east-pilot-cross_road-24 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| random-holdout | kl-east-pilot-cross_road-30 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| random-holdout | kajang-prima-saujana-cross_road-12 | No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point. |
| walking-primary | kl-east-pilot-cross_road-19 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| walking-primary | kl-east-pilot-local_streets-24 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| walking-holdout | kl-east-pilot-long_distance-24 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| facilities | simulated-footbridge-1180007882-1-0 | Route did not traverse the specified navigation facility |

## Reproduce

```powershell
python -m backend.tools.audit_demo_navigation
python -m unittest backend.tests.test_road_priority backend.tests.test_roadside backend.tests.test_open_land_access backend.tests.test_demo_navigation -q
```

Raw JSON.GZ 包含全部 coordinates/geometry/maneuvers/失败原因/timings、sample SHA256 和 algorithm SHA256；summary.json 包含 acceptance flags。

此报告不代表已 push、merge、deploy、执行 SQL 或 build APK。
