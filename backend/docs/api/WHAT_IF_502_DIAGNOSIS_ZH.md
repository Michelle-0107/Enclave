# Repair what-if Compare 502 排查记录

日期：2026-10-20（马来西亚时间）。

## 线上证据

- 用户 Network 截图：OPTIONS 预检 200，Compare POST 约 27.37 秒后 502。
- 公开健康接口返回 200，实际 API 地址是 https://api.enclavehomes.app。
- 预检允许 https://enclavehomes.app、POST、Authorization 和 Content-Type。
- 预检成功不能保证 POST 执行成功；网关生成的 502 也可能没有 CORS 头，被浏览器统一显示为连接失败。
- 当前未访问队友 Render 的日志、内存指标或用户的真实 Compare 请求内容，因此不能认定线上发生了 OOM；502 的线上根因仍需部署后复测或日志确认。

## 已复现并修复的资源问题

Compare 为不同 path 和模式并发调用路由。原来的 functools.lru_cache 只缓存完成的结果，不能阻止同一个路网在首次访问时被多个线程同时加载。两条 path、两种模式会出现四次相同加载，重复占用内存。

加入共享加载锁：同一个图缓存第一次加载时只构建一次，完成后所有调用获得同一个图。锁只覆盖缓存读取/加载，不覆盖路线搜索。Live 和 Demo 的图缓存均使用这个机制。加载失败仍允许下次重试；不同区域保持不同图。

使用两个真实 OSM 起终点、两处模拟维修资料、三个方案（分别修 A、修 B、同时修 A/B），同时请求 Avoid damage 和 Accessible：

| 本地 Windows Python 进程指标 | 修改前 | 修改后 |
|---|---:|---:|
| 冷启动路网加载次数 | 4 | 1 |
| 进程工作集峰值 | 475.2 MB | 187.6 MB |
| 第一次 Compare 耗时 | 1.93 秒 | 1.17 秒 |
| 后续 Compare 耗时 | 0.93 秒 | 0.94 秒 |
| HTTP 状态 | 200 | 200 |

两次均返回 4 个基线路线结果、3 个方案，每方案 4 个路线结果；距离变化分类一致。上述指标仅代表本地单次测量，使用模拟数据库快照，不包含生产数据库、网络和 Render 容器负载，不能用来保证云端时延或总内存。

## 部署后确认

在 Render 搜索 `enclave_compare`：

- `received trace=...`：请求已进入 API。
- `response trace=... status=... elapsed_ms=...`：API 已返回状态和处理时长。
- `failed trace=... elapsed_ms=... error_type=...`：处理抛出未捕获异常，仅记录异常类型。

日志不记录 token、请求内容、起终点、账户或设施资料。如果只有 received、随后出现进程退出/重启/OOM，需结合 Render 同一时间的事件与内存指标判断。如果浏览器出现 502 而完全没有 received，应继续查网关、部署切换或请求是否进入 API。

重新部署这次 backend 修复后，用原来的三方案再试。仅修改前端或 APK 不会让运行中的 backend 自动使用这项修复。

## 回归测试

```powershell
.venv/Scripts/python.exe -m unittest backend.tests.test_graph_cache backend.tests.test_what_if backend.tests.test_what_if_native backend.tests.test_demo_routing_startup backend.tests.test_service_areas -q
```

新增测试涵盖四个并发首次请求只加载一次、同一对象复用、不同区域隔离、失败重试、清缓存、Live/Demo 入口、完整两路径三方案结果，以及 Compare 日志不包含敏感输入。
