# 每约 100m 一个 road section report point

## 用户流程

- 每个 road section 是一个独立的 `path_surface` facility，使用固定 UUID。
- 同一个 section、同一个 fault kind 的 reports 关联到同一个 open issue。
- 同一 resident 重复 report 只计一位 reporter；相邻 sections 独立计数。
- 两位不同 residents report 同一 issue，且从未有 linked report 被 management approve，才进入 What-if candidates。
- Photos、description、ticket 和 status history 仍保留在各自的 report 内。
- App 展示当前 pin 附近的 road sections，用户确认选择；不会仅按 GPS 距离将不同道路自动合并。

## Road catalog

`backend/data/reporting/road_sections.json` 从仓库已有、校验过 SHA256 的 OSM extract 生成。
目前只覆盖已开放 community reporting 的 KL East；Prima Saujana 仍按既有 policy 禁用 community issues。
KL East 共 2,072 sections，包括已记录的道路、人行道和小路。

生成沿实际 polyline 长度分段，每段最多约 100m；路口、OSM way 分界、reporting window 边界及道路末端可形成较短 section。
Report point 位于 section 沿线中点。UUID 基于 area、OSM way、分段锚点和 section index，重复生成保持不变。
不同 OSM ways、路口或重叠但未连通的道路不会因距离近而合并。
Road catalog 是分类依据，不证明道路可步行、安全或无障碍，不改变 motorway/trunk 的 navigation policy。
OSM 数据采用 ODbL-1.0，归属 OpenStreetMap contributors。

## Backend API 和保存

`GET /api/v1/facilities/road-sections?latitude=...&longitude=...&limit=100&offset=0`

要求 active verified resident，返回 100m 内的固定 report points，包含各 section 的 geometry、长度和 road name。
GET 只读，不批量创建数据库 rows，也不生成 reports、votes 或 issues。
App 分页加载并合并附近 report points 与现有设施；重复 ID 去重。
App 按 pin 到实际 section geometry 的距离优先排序，再按 report point 距离排序，以免道路末端短 section 的中点错误抢占相邻长 section。

客户端继续向 `POST /api/v1/community/issues` 提交选中的 facility UUID 和已上传 ticket。
Backend 只允许其自身 catalog 提供 point 名称与坐标；客户端不能提交/覆盖 geometry 或 source metadata。
SQL 019 在同一 transaction 内按需创建 facility 并调用原来的 issue linking rules；照片归属、100m 距离、重复 report、已 resolved issue 等检查失败时，连新建 facility 一并 rollback。
Concurrent first reports 使用固定 facility UUID 和 row lock，最终共享同一 section/issue。
浏览器不能直接调用 private RPC，原有 resident RLS 不放宽。
已经存在的 facility 坐标/名称不被静默迁移；旧 reports、旧 issues 和现有设施不自动改组。

Report point 的 100m 分组不等于整段道路封闭。
Routing 和 What-if 继续使用现有的 point-zone / authored-segment restriction policy，未将 100m section 全长自动标成不可通行。

## 上线顺序

1. 在 Supabase 应用 `backend/sql/019_road_section_reporting.sql`，在 SQL 009 / 018 之后执行。
2. 部署包含新 catalog 和 API 的 backend。
3. Mobile 加载最新 JavaScript；没有新增 native dependency，不需要为这个功能重新 build APK。

旧 backend 返回 404 时，app 显示 road points 暂不可用，并保留已有 facilities 的 report flow。
没有在本次开发中执行 production SQL、创建真实 reports 或修改生产 facilities。

## 更新 OSM 后的维护

`python -B -m backend.tools.build_road_report_points`

该命令只使用本地 source、生成 catalog，不读取 secret、不调用网络、不写数据库。
更新 source 后必须 review 新旧 UUID、坐标及名称差异；已有 linked facility 与新 catalog 不匹配时拒绝关联，不静默移动旧 reports。
先应用 019，再执行旧 009 migration 会覆盖 wrapper；若重装 009，需重新应用 019。
