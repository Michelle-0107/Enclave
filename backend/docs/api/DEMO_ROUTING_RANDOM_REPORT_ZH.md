# Demo 导航随机测试报告

本报告验证本地后端和导航模型，不代表手机实地走测、生产部署或真实道路的通行认证。

路网算法校验：`c428536f45baf2540ca920d3e801a8159320202305a3a830b17872c862b9fca6`。

## 抽样方式

- 两个地区，每类30条不同路线，四类各自计算成功率。固定样本240条，另有不同随机种子的独立验证240条。
- 同侧点取自同一条道路一侧；小路取自不同的住宅/服务道路，直线距离50–500米；长距离至少800米。
- 道路两侧样本在随机道路中心线两侧各8米取点；成功表示路线可用，合理绕行道路末端也算可用。另列实际经过过街设施的数量，不把绕行宣称为斑马线通行。
- 不按连通组件或计算成功与否筛选，失败不换样本。两批种子为20261019和20261020。
- 专项样本按种子20261021选择每种虚构设施30座，并检查全部37处已知真实过街设施。必须在返回的设施ID中找到指定设施，才算专项成功。
- 旧版初测将“有有效绕行但没有经过过街设施”计为跨路失败；最终报告把路线可用率和设施经过数分开，保留全部原始坐标。

## 随机路线结果

| 批次 | 地区 | 类型 | 成功/总数 | 成功率 | 确实经过过街设施 | 本地耗时中位数 |
|---|---|---|---:|---:|---:|---:|
| 20261019 | kajang-prima-saujana | 道路两侧 | 30/30 | 100.0% | 28 | 73.62 ms |
| 20261019 | kajang-prima-saujana | 小路通行 | 29/30 | 96.7% | — | 75.84 ms |
| 20261019 | kajang-prima-saujana | 长距离（直线至少800米） | 30/30 | 100.0% | — | 84.59 ms |
| 20261019 | kajang-prima-saujana | 同侧街道 | 30/30 | 100.0% | — | 65.9 ms |
| 20261019 | kl-east-pilot | 道路两侧 | 30/30 | 100.0% | 25 | 81.92 ms |
| 20261019 | kl-east-pilot | 小路通行 | 30/30 | 100.0% | — | 77.88 ms |
| 20261019 | kl-east-pilot | 长距离（直线至少800米） | 30/30 | 100.0% | — | 98.0 ms |
| 20261019 | kl-east-pilot | 同侧街道 | 30/30 | 100.0% | — | 70.37 ms |
| 20261020 | kajang-prima-saujana | 道路两侧 | 29/30 | 96.7% | 27 | 72.04 ms |
| 20261020 | kajang-prima-saujana | 小路通行 | 30/30 | 100.0% | — | 73.47 ms |
| 20261020 | kajang-prima-saujana | 长距离（直线至少800米） | 29/30 | 96.7% | — | 91.66 ms |
| 20261020 | kajang-prima-saujana | 同侧街道 | 30/30 | 100.0% | — | 67.41 ms |
| 20261020 | kl-east-pilot | 道路两侧 | 27/30 | 90.0% | 24 | 75.78 ms |
| 20261020 | kl-east-pilot | 小路通行 | 30/30 | 100.0% | — | 81.08 ms |
| 20261020 | kl-east-pilot | 长距离（直线至少800米） | 29/30 | 96.7% | — | 95.3 ms |
| 20261020 | kl-east-pilot | 同侧街道 | 30/30 | 100.0% | — | 74.34 ms |

两批合计：**473/480，98.54%**。每个地区、每类、每个批次分别要求至少90%，不以总体平均掩盖某类失败。

## 设施专项结果

| 地区 | 设施类型 | 指定设施确实被经过 | 成功率 |
|---|---|---:|---:|
| kajang-prima-saujana | 虚构斑马线 | 30/30 | 100.0% |
| kajang-prima-saujana | 虚构天桥 | 29/30 | 96.7% |
| kl-east-pilot | 真实过街通道 | 27/27 | 100.0% |
| kl-east-pilot | 真实天桥 | 10/10 | 100.0% |
| kl-east-pilot | 虚构斑马线 | 30/30 | 100.0% |
| kl-east-pilot | 虚构天桥 | 29/30 | 96.7% |

专项失败也保留：路线可能有另一条可行通道，但如果没有经过指定设施，本项仍记失败。

## 地图与导航实现

- 真实设施使用 OSM 过街/天桥几何和已连接的路网边，图标不再凭空代表通路。
- 虚构设施按每条道路均匀布置，不读取随机测试坐标或失败清单；相邻平行街道各有自己的设施。
- 每一座虚构设施有两端真实道路锚点、可通行边、距离和导航指令；地图画出连接线，路线列表及全屏导航显示设施。
- 虚构设施只加载到 Demo，Live 图不含这些边；无障碍模式不能把这些连接当成验证过的无障碍设施。
- 紫色 SZX/SFB 明确表示虚构设施，导航持续显示 Demo 标识；不能据此在现实马路上过街。
- 路网使用带算法和 OSM 校验的压缩 JSON 缓存，校验不匹配时重新构建；不会反序列化可执行 pickle。

## 剩余失败样本

| 批次 | 样本 | 原因 |
|---|---|---|
| random-primary | kajang-prima-saujana-local_streets-22 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| random-holdout | kl-east-pilot-cross_road-04 | No nearby walking access can be connected without crossing a mapped barrier or road. Choose another access point. |
| random-holdout | kl-east-pilot-cross_road-24 | No nearby walking access can be connected without crossing a mapped barrier or road. Choose another access point. |
| random-holdout | kl-east-pilot-cross_road-30 | No nearby walking access can be connected without crossing a mapped barrier or road. Choose another access point. |
| random-holdout | kl-east-pilot-long_distance-22 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| random-holdout | kajang-prima-saujana-cross_road-03 | No nearby walking access can be connected without crossing a mapped barrier or road. Choose another access point. |
| random-holdout | kajang-prima-saujana-long_distance-17 | No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations. |
| facilities | simulated-footbridge-1180007882-1-0 | Route did not traverse the specified navigation facility |
| facilities | simulated-footbridge-779969810-0-0 | Route did not traverse the specified navigation facility |

完整坐标、路线几何、导航步骤、失败原因及耗时保存在同目录 `demo-routing-audit/` 的 `.json.gz` 文件，解压即为 JSON。`summary.json` 可直接查看汇总。

## 部署确认与复测

```powershell
python -m backend.tools.build_demo_crossings
python -m backend.tools.audit_demo_navigation
python -m unittest backend.tests.test_demo_navigation
```

GitHub push、合并 main 和 Render 完成部署是不同步骤。公开健康检查正常不能证明路由代码已更新。
部署后 `/health` 响应头应有 `X-Enclave-Routing-Revision: demo-crossings-v1`，Demo dataset 应返回 `navigationFacilities`。
手机浏览器也可直接打开 `/health/routing`，应看到 `{"routing_revision":"demo-crossings-v1"}`；404 或旧版本表示新代码还未部署到该服务。
本次没有发布 EAS Update 或构建 APK；移动端通过开发服务器加载修改，后端需部署后才在手机生效。
