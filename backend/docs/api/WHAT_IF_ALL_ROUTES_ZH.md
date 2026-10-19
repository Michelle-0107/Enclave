# Compare all routes 与 AI summary

## 使用流程

1. 输入各条 path 的起终点、各方案的维修设施，可选填写维修价格和 budget。
2. 按 Compare repair plans，得到相同快照和固定起终点的比较结果。
3. 在 Path and route mode 选 `Compare all routes · Avoid damage` 或 `Compare all routes · Accessible`。各维修方案同步切换。
4. 每个方案的地图显示该模式全部路线的 Before / After；地图下列出每条路线的距离、耗时、shorter/longer 和节省时间。选择单条路线时恢复单条显示。
5. 所有方案下方的 AI summary 独立加载。Compare 不等待模型返回。

## 判断规则

- 汇总每条 journey 各走一次的耗时，不推算居民人数、每日使用次数、全年收益或现金回报。
- 为公平比较，各方案使用同一组有实际 Before / After 耗时的 path；缺失路线不计为零秒。
- 新恢复可用路线单独列数，没有可比较的旧耗时时不虚构“节省时间”。方案造成已有路线失效时不推荐。
- 无障碍模式的 walking reference 保留显示标签，但不计入无障碍时间收益。两种路线模式不相加。
- 价格或 budget 未填保持未知，不当作零。明确填入 `0` 则表示已知零费用。
- 价格全部完整且有 budget：排除超预算方案，在预算内优先时间收益最高者，同等时间收益选较低费用。
- 价格全部完整但无 budget：比较节省时间/维修费用，再比较总时间收益。正收益的已知零费用方案优先。
- 价格不完整：按时间排序；若已有 budget，仍排除已知超预算的方案，但未知价格方案不能确认是否负担得起。
- 无共同可比耗时、没有正收益或方案均不符合条件时，不强行推荐。

## AI 与自动计算的分工

数值和推荐方案由上述确定性规则计算，模型只解释结果。AI 没有通过随机路网数据训练成维修预测模型，也不预测实际维修费用。

经用户授权，后端复用现有 Bedrock 设置，失败时使用现有 Gemini 配置。外发内容只有匿名方案编号、耗时/节省量、费用、budget、可比与不可用数量及已计算推荐结果；不发送账户、token、设施名称、道路名称或坐标。Bedrock/Gemini 密钥不进入前端。

模型输出不决定数字和排名；数值由独立卡片展示。模型不可用、超时或返回不合格式时，接口仍返回计算结果，并标记 `source: calculated`。前端明确显示 `Calculated summary · AI unavailable`，不会假装规则文字是模型生成。

## 接口

```http
POST /api/v1/management/what-if/{simulation_id}/summary
Content-Type: application/json

{"route_mode":"avoid_damage"}
```

使用现有管理 JWT。只接受已完成比较的 simulation ID 与路线模式，不接受客户端自行编造的费用或收益统计。每次请求重新检查 management 权限，并校验比较属于当前用户。

内存最多保留 32 份轻量统计、每份十分钟，不保留路线几何。重启、过期或被逐出后返回 404，用户重新 Compare 即可。相同用户/比较/模式的结果复用；同时最多生成两份摘要。超时十秒回落到计算汇总；缓存和服务关闭均有清理。模型内部网络设置更短时限。

## 部署及验证

需同时部署 frontend web 和 backend；无需 SQL migration，也无需构建 APK。AI 使用现有 `AWS_REGION`、`AWS_ACCESS_KEY`、`AWS_SECRET_ACCESS_KEY`、`BEDROCK_MODEL_ID`、`GEMINI_API_KEY`，不新增前端密钥。

```powershell
.venv/Scripts/python.exe -m unittest backend.tests.test_what_if_summary backend.tests.test_what_if -q
node --test frontend/enclave-web/tests/repair-route-view.test.cjs
```

测试覆盖时间排序、预算过滤、单位费用收益、缺失价格、零费用、无障碍参考不重复计数、丢失路线、共同可比集合、权限及用户隔离、缓存和并发上限、AI 超时、Bedrock 到 Gemini 回落、模式切换时旧响应被忽略、单条/全部路线图层清理。

接口实现参考：[Amazon Nova Invoke](https://docs.aws.amazon.com/nova/latest/userguide/using-invoke-api.html)、[Gemini Generate Content](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6)。
