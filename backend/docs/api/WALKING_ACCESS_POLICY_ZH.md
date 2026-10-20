# 步行路网与建筑物起终点规则

此规则在后端统一执行，适用于所有已启用区域的 Live 和 Resident Demo，地区资料不写入前端。

## Recorded roads first

- 固定 endpoint access 后，优先使用 recorded roads、footpaths 和可用 facilities。只有这些连接无法完成 journey 时才使用 <=20m 的 inferred links；fallback 先最小化 inferred distance，再最小化实际 walking distance。显示的 distance/ETA 仍由真实 geometry 计算，不含优化 penalty。
- OSM extract buffer 用来保留 service window 外已下载的 recorded-road detours，endpoint 仍必须位于原 service area。路线经过 buffer 时返回明确 warning，不扩大可选择起终点范围。
- Mapped road bridge / underpass 在真实共享 OSM approach node 上保持同侧连续；不同 level 的几何交叉不会自动连接，也不能连接对面车道。
- 用户已明确确认 trunk roadside policy：仅 OSM `highway=trunk`、`access=yes`，且没有 `foot=no` / `foot=use_sidepath`、`motorroad=yes` 或其他硬性禁用时接纳。`motorway`、`motorway_link`、`trunk_link` 不因此开放；无设施横穿仍禁止。这是 product policy，不是 surveyed sidewalk 或实地通行认证，route 包含专用 warning。
- Demo 在 OSM extract buffer 按统一75m geographic spacing 增补明确虚构的 crossings/footbridges；保留既有 facility IDs，approach 只关联同一 mapped way，调整不得超过20m或穿障碍。虚构设施不是 open-land gap，绝不进入 Live graph。
- 95% audit、原480 rerun、facility专项及全部失败参见 [Routing 95% audit](DEMO_ROUTING_95_REPORT_ZH.md)。旧 report 保留为历史 baseline。

## 没画出来的小路与空地

- 两段断开的地面步行通道，相距不超过 20 米，且中间没有已知障碍时，可以补上推定连接。封闭环形小路也参与补接，不只检查断头端点。
- 连接会检查 OSM 中的建筑物、围栏、墙、水域、河道与禁止通行区域。围栏上的已绘制可通行大门可以使用，上锁的大门不能使用。
- 道路两侧的既有规则继续适用：私人住宅小路使用居民过街政策，其他道路使用地图已有的过街设施。空地连接不能直接横穿主路。
- 推定连接会出现在路线几何、距离与指引中；维修避障也会检查这些连接。
- 长距离必须沿已记录的道路、人行道或设施连接计算；不能因地图空白就跨越几十或上百米空地。真实道路或已记录设施本身超过 20 米不受短缺口上限限制。
- Demo 另有明确标注的虚构过街设施，只有 Demo 使用这些连接。Live 不使用虚构设施。详见 `DEMO_ROUTING_RANDOM_REPORT_ZH.md`。

## 起点或终点

- 室外点可以关联到 20 米内、连接路径不穿过障碍物的步行通道。
- 室外接近通道的距离超过 5 米时，会把接近路线画出来并计入距离。
- 只有 OSM 建筑物轮廓明确包含起点或终点时，才默认用户可离开该建筑物。建筑物点关联最近可接入的已记录道路、人行道或接触该建筑物的天桥入口，不设距离上限；搜索仍限于已启用服务区域。
- 该例外只放行起终点所在建筑物，不能穿过其他建筑物、围栏或道路。
- 建筑物点固定关联最近可接入路段，不能为了算出路线而改吸附到更远的路；最近路段无法到达另一端时应如实返回无可用路线。室外点仍只在 20 米范围内考虑接入。关联点的选择不受维修选择影响，避免维修前后偷偷换起终点。
- 建筑物内部路线不作模拟；返回的路线从关联通道或入口开始、结束。`origin_snap_distance_meters`、`destination_snap_distance_meters` 表示请求点到路线端点的距离，室内距离不计入路线距离。

## 资料性质

推定空地通道和默认建筑物出口不能视作经过现场验证的人行道或无障碍设施。API 的 `warnings` 会说明使用了哪些假设，`field_verified` 保持 `false`。Demo 的无障碍模式也不能使用这些未经验证的连接。

未绘制的障碍物无法由现有资料识别。这里实现的是产品要求的默认可通行假设，而非实地通行认证。

## 验证与生效

```powershell
python -m unittest backend.tests.test_open_land_access backend.tests.test_roadside backend.tests.test_demo_facility_mapping backend.tests.test_service_areas
python -m backend.tools.refresh_demo_routing
python -m backend.tools.audit_demo_navigation
```

真实资料回归使用 KL East Mall 的三个地图位置和原先误标为斑马线的人行道。测试不使用住户账号或生产数据库。

修改后需部署或重启后端，清除进程内的路网缓存。现有 App 使用同一 API，无需重新构建 APK。
