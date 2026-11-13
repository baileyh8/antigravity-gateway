# agy CLI 1.5.7 对照

本版本以官方自动更新器校验后的 1.5.7（build 1019769835）为基准。所有官方协议采集均使用独立 HOME、虚构凭据、仅回环网络的 Seatbelt 沙箱和全响应假上游；不借用真实账号生成流量。感谢 LeeFeee 上游 v2.0.1/v2.0.2 的研究、HTTP/2 和账号一致性实现。

官方二进制标记为 Google Go 1.28 预览构建（go1.28-20261102-RC00），网关使用稳定 Go 1.27.2。下述一致性来自抓包字段对照，不代表编译器或二进制同源。

## 已核对

- macOS arm64 官方 HTTPS 的密码套件、扩展顺序、签名算法、supported groups 与 ALPN `h2,http/1.1`。官方与网关的 HTTP/2 SETTINGS（ENABLE_PUSH=0、初始流窗口4194304、最大帧1048576、最大头列表10485760）及连接窗口增量1073741824也一致。Go 1.27.2 原生传输使用正常证书校验；代理仍按账号原绑定，不回退直连。六个平台二进制附 SHA256 清单。其他平台打包构建通过不等同于在每台系统运行官方 CLI 抓包。
- 元数据、同步生成、Token、Userinfo 使用 HTTP/2；流式生成不伪造 Content-Length。Go 测试验证 12 路 HTTP/2 请求复用一条连接。协议升级不改变每账号并发、排队、额度保留及粘连策略。
- 24 个 agent 模型变体的实际最终请求体与模型 enum；图像生成单独采集，不把图片模型当作 agent 运行。模型配置证据在 `tests/fixtures/agy-1.5.7-model-wire.json`，有效目录字段样本在 `src/data/agy-1.5.7-models.json`。

| 模型 | 思考字段 | 默认输出上限 |
| --- | --- | --- |
| Gemini 3.8 Flash、Argon 各档 | thinkingLevel: LOW / MEDIUM / HIGH | 65536 |
| Claude 5.5 Sonnet / Opus 各档 | thinkingLevel: LOW / MEDIUM / HIGH | 128000 |
| Hydrogen Low / Medium / High | thinkingLevel: LOW / MEDIUM / HIGH | 262144 |
| Hydrogen XHigh | thinkingLevel: **100（数字）** | 262144 |
| GPT-OSS 120B Medium | thinkingBudget: 8192 | 32768 |
| Flash Lite 目录变体 | thinkingLevel: LOW | 65535 |
| Gemini 3.1 Flash Image | candidateCount: 1 + imageConfig | 不附 agent 思考参数 |

历史标签也按逐模型抓包处理：Hydrogen 的 `used_non_gemini_model` 为 true，不能由公开模型名的 `gemini-` 前缀推断；Claude 的两个 used_claude 标签均为 true。历史上的累积标志仍保留。

输入/输出限制仍读有效目录及客户端合法输出设置。公开模型名不擅自换成其他模型，不根据后缀合成未观察过的思考配置。Hydrogen 样本来自此前观察到的目录条目；这不代表当前所有账号都有权限。路由继续按每账号目录筛选。

## 工具与 system

原生工具声明来自本次官方抓包，保存在 `tests/fixtures/agy-1.5.7-tools.json`。官方 `edit_file` 会替换全部匹配文本；客户端 `replace_all=false` 必须使用完整 MCP 视图，不能假装两者等价。相同原则用于命令 timeout、后台运行、PTY、工作目录和审批权限。

每个客户端工具都有完整 `argumentsJson` MCP 视图，未识别的客户端也可以无损传递。可等价表达的文件操作另有受约束的原生视图；冲突时不猜。回包恢复原工具名、原参数、调用 ID，后续回执恢复对应的上游名称，完整历史匹配时保留真实签名。Anthropic Messages、Chat Completions 和 Responses 的工具往返与重启恢复均有测试，自定义工具保持原 kind。

system 保留客户端原始指令和用户项目规则，并追加明确的工具索引。官方客户端包含自己独有的工作区、artifact、任务和权限实现；网关不会声称这些执行器存在，也不会删除客户端审批限制来凑相同字数。旧工具协议可用 `ANTIGRAVITY_TOOL_CONTRACT=legacy` 回退。已有旧协议测试显式固定该回退分支，新默认协议由独立的三协议闭环测试验收。

## 账号一致性与缓存

凭据刷新只合并 Token/到期/project/authMethod 字段，并校验授权代次；删除或新授权后的旧结果被丢弃。启停、权重和健康状态不由旧刷新对象覆盖。升级时已有隔离状态保守保留，不自动解冻。

网关不创建 cachedContents。客户端的显式 cache_control 不转换成缓存资源；实际命中和计量来自上游 cachedContentTokenCount。阈值、可缓存内容和折扣由所用服务/模型决定，不能统一承诺 4096 tokens 或 95%。账号粘连有助于同一账号上的缓存复用，但额度和健康保护仍优先。

抓包与单元测试不能证明账号不会受到服务限制，不能替代当前授权和真实生成验证。此版本没有通过测试账号并发上限来选择容量。
