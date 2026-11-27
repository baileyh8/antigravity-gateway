# Changelog

## 1.7.1-bailey.51 - 2026-11-27

- 管理后台统一显示完整账号邮箱，覆盖账号卡片、仪表盘、编辑与删除确认、授权完成提示、用量、请求/诊断日志及 CSV 导出；搜索可匹配完整邮箱。管理 API 增加 `email` 字段，保留旧 `emailMasked` 字段兼容既有调用方，运行诊断文件仍使用脱敏标识。
- Show full account emails across the admin UI, confirmation dialogs, OAuth completion, usage, request/diagnostic log views and CSV exports. Search accepts full emails. The admin API adds `email` while retaining `emailMasked` for compatibility; diagnostic files keep masked labels.

- 账号套餐、健康核验结果及时间可持久化并在重启后恢复，常规 OAuth 续期保留这些元数据；429 核验结果单独显示为限流，不误标为 TOS 或健康。
- Persist checked account plans and health observations across restarts and token renewal; show HTTP 429 separately from health success and TOS restrictions.

- 管理后台账号页改为桌面三列的紧凑卡片，5h/周额度并排、完整信息和低频操作折叠进详情：健康/TOS、套餐、启停、各组额度与重置时间、代理绑定、编辑和备注同页显示，筛选改为平铺按钮。代理管理迁至设置，保留逐账号出口编辑。过期额度明确标为历史数据；暂停与健康状态独立，普通403不误判为TOS。
- Admin account cards now combine health, plan, scheduling, quota/reset windows, proxy binding and notes. Filters are flat buttons; proxy management moves to Settings. Account health remains distinct from scheduling, with explicit TOS evidence and stale-quota labels.

## 1.7.1-bailey.50 - 2026-11-25

本版本汇总 `1.7.1-bailey.49` 与 `1.7.1-bailey.50` 的全部客户端兼容补强与诊断更新：

- 客户端兼容架构补强：
  - `ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE` 扩展为四档分级策略：`0`/`off` 关闭、`1`/`neon` 仅 Neon（保持旧配置兼容）、`gemini4` 覆盖全部 Gemini 4（Neon / Hydrogen / Sonar / Carbon / Argon）、`all` 覆盖全部 Gemini，按协议角色隔离客户端指令而不依赖版本或模板指纹。
  - 解除 Claude Code 单版本号锁死并兼容代理转发：新增 `claude-code-generic` 通用 profile 匹配合法 `claude-cli/<semver>`，同时支持 `anthropic` 与 `chat` 协议且不再强要求 `x-claude-code-session-id`（解决经 Magpie 等本地代理转为 `/v1/chat/completions` 并剥离会话头后无法识别的问题；`2.1.285` 自动压缩精确门禁保持不动）；工具映射继续按 Schema 精确形状判定（保留新版 `Read` 的 `allow_large`，继续翻译 `Write` / `Edit` / `Bash`）；`x-anthropic-billing-header` 的 `cc_version` 放宽为任意 semver（仍要求完整框架哈希）。
  - 解除 DSH 对原始 `User-Agent` 的强依赖：经 Magpie 等本地代理改写 UA（如 `Bun/1.4.4`）后，命中精确系统提示词段落与精确工具声明仍正常识别。
  - 放宽通用工具语义推导（`src/agy-tool-semantics.js`）三道门槛：接受省略 `additionalProperties`（仍拒 `true` 与根级组合器）、支持 Zod/Pydantic 可空可选字段（`type: [T, 'null']` 与 `anyOf`/`oneOf` 二选一 `null`，原生声明规整为标量）、新增 `endLine`（`end_line`/`line_end`/`to_line`）与 `StartLine`/`EndLine` 1:1 映射及高频无损别名，修复自定义 count 参数回写键名。
  - Codex 框架身份句清理新增结构化骨架锚点兜底：在精确 SHA-256 匹配未命中时，对已验证 Codex `originator` 且满足长度（≥4000）与多锚点骨架的未来版本框架仅规范开头身份句，保留全部权限规则、工具与历史。
- 诊断与管理后台可见性：
  - 新增离线干跑诊断模块 `src/client-compat-diagnose.js` 与命令行参数 `antigravity-gateway --diagnose-request <file|->`（可选 `--protocol` / `--model`），零上游请求输出客户端识别、指令封装、思考参数与逐工具视图/拒绝原因。
  - 请求日志 `conversion` 增补白名单 `clientProfile`；独立管理后台 `/admin/logs/` 请求详情弹窗新增结构化兼容与转换摘要卡片。
- 验证：968 项网关测试、10 项管理后台测试（4 后端 + 6 前端）、Next.js 静态构建与 `npm pack` 全部通过；真实上游实测覆盖未来版 Codex（`0.175.0`）走 Hydrogen Sonar 与 Carbon、`claude-cli/2.4.12` 走 Neon 带工具流式两轮、T3 Code Claude 子代理（`claude-cli/2.1.327` 经 Magpie）走 Hydrogen High 两轮（90.5% 缓存命中、46/46 Schema 缓存命中）、改写 UA 的 DSH 走 Argon 两轮、OpenCode 风格可空+`end_line` 工具走 Hydrogen 两轮，以及 CLI 离线干跑。

English: Consolidates all client compatibility and diagnostics updates from `1.7.1-bailey.49` and `1.7.1-bailey.50`: tiered `ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE` scopes (`0`/`off`, `1`/`neon`, `gemini4`, `all`); version-independent `claude-code-generic` supporting both `anthropic` and proxy-relayed `chat` traffic without requiring `x-claude-code-session-id` (while keeping schema-verified tool rules and `2.1.285` compaction gates intact); proxy-resilient DSH detection; expanded generic tool semantics for omitted `additionalProperties`, nullable optional fields (Zod/Pydantic), and direct `start_line`/`end_line` mapping; structural-anchor fallback for future Codex prompt wording; offline `antigravity-gateway --diagnose-request <file|->` CLI diagnostics; allowlisted `conversion.clientProfile` logging; and structured conversion summaries in `/admin/logs/`. Verified with 968 gateway tests, 10 manager tests, Next.js build, `npm pack`, and live upstream round-trips across Hydrogen Sonar, Carbon, Neon, Argon, and Hydrogen High.

## 1.7.1-bailey.48 - 2026-11-23

- 模型调用链路与工具翻译优化：
  - Schema Worker 池引入 2048 条有界编译 LRU 缓存，并将默认并发 worker 数提升至 2；单次请求内去重工具与视图 Schema 编译，零主线程 Ajv 约束保持不变。
  - 直连模式放开 Anthropic `/v1/messages` 与 Responses `/v1/responses` 带工具请求的实时流式文本/思考推送；Anthropic 实时流在结束前按原序补发签名承载块与并行 `tool_use` 块，保持签名对应关系。
  - 指令封装移至原生上下文/签名恢复之后，`nativeWrapped()` 识别 `<CLIENT_SYSTEM_INSTRUCTIONS>`，避免被二次套进 `<USER_REQUEST>` 与本地时间戳，动态系统提示更新不再打断会话 `historyPrefix` 签名链。
  - MCP 兼容工具名新增可读前缀 `mcp_gateway_tool_<slug>_<hash16>[_json]`（总长 `<= 64` 字符，兼容旧纯哈希回执）；`mcp-json` 解码失败时支持安全剥离单层 Markdown JSON 代码围栏后继续执行严格 Schema 校验。
  - 修复 `codexTemplate()` 仅匹配 `CODEX_167_CLIENT_PROFILE` 导致的在线死分支；集中管理模型签名与历史兼容配置，并将 `maxOutputTokens < 1024` 保底扩展到全部开启思考的 Gemini 4 模型；Responses 支持明文 `compaction` 摘要并明确拒绝加密 `encrypted_content`（400 `unsupported_encrypted_compaction`）。
  - 新增上游静默空响应检测（无 `finishReason` / `promptBlockReason`、无正文/思考/工具调用时返回 `502 empty_upstream_response`，不冷却健康账号并写入脱敏日志与诊断）；脱敏 `conversion` 日志补充 `thinkingLevel: 100`、`identityProfile`、`envelopeApplied`、`toolViews`、`schemaCache`。
- 网关安全、稳定性与模块化重构：
  - 新增受信任代理感知的 `resolveClientIp()`（默认仅信任回环代理，取最右非信任跳），同步用于密钥白名单与请求日志；修复多密钥模式下 `OPTIONS` 预检、公开文件直链与非回环绑定校验，修复 `protocol` TDZ 与 `GET /v1/models` 缓存及 `/_admin/v1/models?force=1`。
  - 抽取 `src/client-ip.js`、`src/multipart.js`、`src/sse-emitters.js`、`src/client-catalogs.js`，合并 `AccountPool` 的 `send()` / `generateImage()` 共享调度路径，优化会话剪枝增量字节估算，清理零引用旧模块 `gemini-account-store.js` 与 `server-search-protocol.js`。
  - 请求日志补齐 `stream`、`bytes`、`upstreamModel`、`ttftMs` 及客户端中断 `499 / request_aborted`。
- 管理后台（Manager Server & Web）安全与体验改进：
  - 后端拆分 6 组路由模块，改为异步 `scrypt` 校验与有界登录限流，修复生产默认 CORS 来源、审计日志串行写入与翻页扫描上限，复用网关共享日志读取器。
  - 前端缓存 CSRF Token（403 自动刷新重试一次），账号列表新增一键启用/暂停开关（即时生效并记入审计），修复异常账号筛选与看板缓存命中率公式，日志页引入 `AbortController` 竞态取消，移除已退役 Robin/Gemini App 模型筛选。
- 验证：959 项网关测试、9 项管理后台测试、Next.js 生产构建与 `npm pack --dry-run` 全部通过；本机与固定出口隔离真机实测通过 Anthropic/Responses 带工具流式、Hydrogen/Carbon/Neon/Argon 新旧会话与工具往返、小预算思考保底及 Schema 缓存 100% 命中（同时记录 `Carbon → Hydrogen Sonar` 上游偶现/稳定静默空流并补齐 502 防御）。线上 VPS 生产服务需另行部署，不以本发布等同已上线。

English: Optimize the model-calling pipeline (bounded worker-pool schema compile LRU cache, live Anthropic/Responses streaming with tools, decoupled instruction envelope preserving multi-turn thought-signature history, readable MCP compatibility tool names with fenced `argumentsJson` recovery, Gemini 4 thinking small-budget floor, Responses plaintext compaction support, explicit 502 detection for silent empty upstream streams, and sanitized conversion diagnostics including Hydrogen XHigh `thinkingLevel: 100`). Harden gateway IP/auth boundaries, modularize core helpers and pool execution, and upgrade manager server/web security, route modularity, CSRF caching, and state filters. All 959 gateway tests, 9 manager tests, Next.js build, and controlled live upstream checks pass.

## 1.7.1-bailey.47

- 新增 Neon 通用指令封装开关，按归一化 Responses/Anthropic/Chat 的 system/developer 来源识别，不以客户端 UA、版本或固定框架摘要作为启用门槛。完整保留指令、安全权限、工具契约与生成参数。
- 封装读取工具及结构化输出适配后的最终客户端指令，避免适配前后文本不同而跳过封装；既有工具映射权限独立保持。
- 补齐 Neon 四个档位的旧会话无签名历史兼容标记，真实签名优先保留，不从调用 ID 或参数构造签名。
- 开关 `ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE=1` 仅扩大 Neon 的通用封装，默认关闭，其他模型继续既有处理。未改变账号出口、额度保护、会话调度或并发；不将通用 429 误判为已消除的外部容量限制。

## 1.7.1-bailey.46

- 补齐 Claude Desktop 标题及分支名辅助调用的短 system 模板，支持 SDK 多段文本及 Magpie 合并后相邻的身份句/任务指令。
- 仅识别固定标题指令及已捕获环境安全布局，沿用指令分离封装；完整保留原 system、安全规则和用户描述，不改权限检查或推理档位。
- 标题指令识别不参与工具视图版本选择；新增 Chat/Anthropic、直接/SDK布局、内部工具、变异拒绝和多模型参数回归。

## 1.7.1-bailey.45

- 兼容官方 Claude Desktop SDK 的另一种固定身份前缀（running within the Claude Agent SDK），仍要求完整框架摘要与段落边界；修复前缀差异导致指令封装被跳过。
- 回归测试要求两种 SDK 身份前缀及无前缀布局产生相同的指令语义，任意增添的未知前缀不匹配。

## 1.7.1-bailey.44

- 补齐 Claude Desktop 直接组装固定框架、没有 SDK 默认身份前缀的指令布局；仍要求完整已捕获框架摘要和 guidance 边界，不按 UA 直接改写。
- 让该布局进入已有的指令分离封装，保留权限、安全指令和签名工具往返；其他客户端、账号调度与 Magpie 本体不变。
- 新增无身份前缀的识别、变异拒绝及最终出站封装回归测试。

## 1.7.1-bailey.43 - 2026-11-21

- 修复已验证的 Claude Desktop SDK 2.1.330 与 Hermes 的 Gemini 指令封装；客户端指令放入独立消息，system 明确其优先级、安全与权限约束，网关工具契约保持原位置。原历史、工具参数及签名保留。
- 指令封装识别与工具视图版本解耦；保留旧 Hermes 文件工具视图和 Claude 标准框架的已验证工具兼容。Hermes 自定义 SOUL 不被替换，重复或未知框架不猜测归属。
- DSH 0.2.2-rc.1 的普通与长规则样本均正常，保持其指令位置；补齐 `max_completion_tokens`，按账号实时模型目录约束输出上限。冷启动共享一次有界目录查询，不增加生成重试、不调整思考档。
- 脱敏、同账号固定出口串行验证：Claude 原位置429→独立消息200→恢复原位置429；正式封装的 Claude、Hermes、DSH 生成与带签名工具续接均200。不宣称消除所有上游429或容量波动。
- 后台、调度、并发、额度保护、原生传输和 Magpie 本体保持；不新增转接服务或更新器。

English: Repair verified Claude Desktop and Hermes instruction placement on Gemini while preserving client-policy precedence, safety and signed tool continuation. Keep instruction provenance independent of tool-view compatibility. Preserve working DSH placement and support completion-token budgets within live catalog limits, sharing a bounded cold metadata lookup. Controlled synthetic generation/tool roundtrips pass; external capacity and quota errors remain possible.

## 1.7.1-bailey.42 - 2026-11-20

- 明确的 `503 UNAVAILABLE / MODEL_CAPACITY_EXHAUSTED` 只发送一次，不再立即切入口或换账号；保留合法上游退避提示，无提示时按模型冷却 60 秒。
- 容量冷却不修改账号健康、额度冷却或会话绑定；后续同模型请求使用现有 120 项共享队列和 30 秒累计等待预算，仍无容量时返回 503 与剩余冷却时间。其他模型不受该模型冷却影响，原并发和额度预留保持。
- 直连 Responses 默认在上游接受后开启 SSE，避免拒绝被包装成 HTTP 200 并触发客户端反复重连。显式 `X-AGY-Defer-Stream-Start: 0` 保留旧行为。
- 保留 HTTP 200 流内顶层与嵌套 RPC 错误的结构化状态、容量原因和 RetryInfo，避免把流内拒绝误判为普通临时失败或成功。
- 脱敏转换日志增加最终 system 字符数与输出预算，不记录正文、凭证或工具定义。该修复解决重试放大和错误反馈，不声称解决真实上游容量不足。

English: Stop explicit model-capacity retry amplification; preserve model-local cooldown and retry timing through the bounded shared queue without penalizing account health or quota. Defer direct Responses SSE until upstream acceptance by default, retaining an explicit legacy opt-out. Add content-free system-length and output-budget diagnostics. Actual upstream capacity remains external to the gateway.

## 1.7.1-bailey.41 - 2026-11-20

- 修复 Codex Desktop 0.169.1 将目录模板放在首个 `developer` 消息时漏过兼容处理的问题；补齐旧 GPT 会话保留的已验证 stock 框架，避免切换模型时继续漏匹配。仅调整精确摘要匹配的固定模型身份句，保留客户端权限、安全规则、工具契约和历史。
- 上游返回无明确细节的 `RESOURCE_EXHAUSTED` 429 时停止立即切入口、重试和换账号，避免单请求被放大成多次调用。保留合法 `Retry-After` / `RetryInfo`，长冷却直接反馈调用方。
- 实时模型目录排除明确禁用的条目，较旧的目录或额度刷新结果不再覆盖较新的模型权限与元数据。
- 账号配额预留、并发、调度参数和 Hydrogen 工具签名兼容保持原有策略。

English: Recognize verified Codex Desktop developer catalogs and retained GPT stock frameworks during model switches. Preserve all other instructions, permissions, tool contracts and history. Stop immediate endpoint/account amplification for unspecified resource-exhaustion refusals, preserve cooldown hints, and keep stale discovery results from restoring superseded model access.

## 1.7.1-bailey.40 - 2026-11-19

- 参考 LeeFeee 上游 2.2.1，保留首入口明确的 `503 UNAVAILABLE / MODEL_CAPACITY_EXHAUSTED`，防止备用入口的通用 429 覆盖容量不足证据。明确配额、认证和请求错误仍按实际结果处理。
- 为实际生成请求记录各上游入口的失败状态、合法 `Retry-After` 和已知结构化原因，并记录消息、工具与签名数量。诊断不记录提示词、凭证、工具正文或签名原文。
- 包含 .39 的模型冷却 `Retry-After` 与 Responses 延迟启动支持。相关转发网关需要传递冷却信息才能完成退避。
- 验证了 886 项自动测试及基座部署健康。Carbon、Hydrogen 的新会话与旧会话切换实测尚未全部通过，本版本不承诺解决所有通用 429。

English: Preserve explicit upstream model-capacity failures across a fallback generic 429, following LeeFeee 2.2.1. Add bounded, content-free per-endpoint failure and conversion diagnostics. Include .39 cooldown Retry-After and deferred Responses streaming support. All 886 automated tests passed. Carbon/Hydrogen fresh-session and model-switch live acceptance remains incomplete.

## 1.7.1-bailey.39 - 2026-11-18

- 账号池因模型冷却暂不可用时，按最早可用账号的实际剩余冷却时间返回 `Retry-After`。Responses 转发网关可用 `X-AGY-Defer-Stream-Start: 1` 等待上游响应头，以保留首个 429 的 HTTP 状态和退避时间。

English: Return `Retry-After` based on the earliest eligible account's remaining cooldown. Responses relays can set `X-AGY-Defer-Stream-Start: 1` to preserve the first upstream refusal as HTTP 429 with the retry interval.

## 1.7.1-bailey.38 - 2026-11-18

- 兼容新版 Codex Code Mode `exec` 的 Lark grammar 中两处已验证的空行，修复网关构建请求时的 `unsupported_tool_grammar`。其他 grammar 继续按原规则校验，工具输入、调用 ID、签名与回执继续原样传递。

English: Accept the two verified blank lines in the newer Codex Code Mode `exec` Lark grammar. Other grammars still follow the existing validation rules. Tool input, call IDs, signatures, and receipts are preserved.

## 1.7.1-bailey.37 - 2026-11-18

- 兼容 Codex Desktop 通过 Responses 顶层 `instructions` 发送的已验证目录框架，处理 Carbon Medium 脱敏对照复现的上游 429。保留其余指令、用户消息、工具和模型参数。

English: Recognize the verified Codex Desktop catalog framework in top-level Responses instructions. This resolves the upstream 429 reproduced in the Carbon Medium control while preserving other instructions, tools, and model parameters.

## 1.7.1-bailey.36 - 2026-11-18

- 生图和参考图编辑支持通过 `X-AGY-Image-Response-Format: b64_json` 指定默认以图片数据交付。请求体显式指定的 `response_format` 优先。

English: Allow image relays to request inline image data by default with `X-AGY-Image-Response-Format: b64_json`. An explicit `response_format` in the body takes precedence.

## 1.7.1-bailey.35 - 2026-11-18

- Codex Responses 的已验证框架描述兼容覆盖所有 Cloud Code 模型，包括 Argon 和动态发现的模型。只有请求来源、框架指纹和指令投影匹配时才处理固定段落，保留原工具契约、签名、思考档和账号调度。

English: Apply the verified Codex Responses framework handling across Cloud Code models, including Argon and dynamically discovered models. Preserve tool contracts, signatures, thinking settings, and scheduling.

## 1.7.1-bailey.34 - 2026-11-18

- 在 Hydrogen XHigh 的 Responses 链路上启用已验证的 Codex 框架描述兼容。仅处理匹配既有指纹的固定身份段落，保留数值 `thinkingLevel: 100` 和完整工具历史。

English: Extend the verified Codex framework compatibility to Hydrogen XHigh Responses requests while retaining numeric thinking level 100 and tool history.

## 1.7.1-bailey.33 - 2026-11-18

- 修复 Messages 流式与非流式并行工具调用的签名串位，接入 `disable_parallel_tool_use`。保留 Claude Opus / Sonnet 5.5 三档在目录暂缺时的实测模型枚举和请求元数据。

English: Keep Anthropic Messages tool signatures associated with their calls, honor `disable_parallel_tool_use`, and retain captured Claude 5.5 model metadata when the live catalog lacks those fields.

- 将 Argon 和 Low、Medium、High 三档纳入旧工具历史签名兼容，保留已有签名。三档保留已验证的模型枚举与目录上限，基础 Argon 在两个模型目录视图里统一应用手动上限。

English: Extend missing tool-history signature compatibility to base Argon and its three tiers. Preserve captured tier metadata and use the same configured base Argon limits in both catalog views.

## 1.7.1-bailey.32 - 2026-11-18

- 修复 Carbon 续接缺少 `thought_signature` 的旧工具历史时返回 400 的问题。历史恢复后，优先使用已有签名，仅对每组缺签名的首个模型工具调用使用现有兼容标记。

English: Apply the existing missing-signature handling to Carbon tool history after native history restoration. Preserve existing signatures and add the compatibility marker only to the first call in a tool-call group when its signature is missing.

## 1.7.1-bailey.31 - 2026-11-18

- 兼容 Codex `exec` 自定义工具的 Lark 声明。保留原始输入、工具命名空间和调用 ID，支持带签名的工具回执续传。

English: Support the Codex `exec` custom tool grammar while preserving raw input, the tool namespace, the call ID and signed tool history.

## 1.7.1-bailey.30 - 2026-11-18

- 修复 Carbon 经 Codex/Magpie 调用时的框架身份兼容：在已验证的 Responses 来源与模板指纹下，识别重复的新旧框架，仅规范三处固定身份描述，保留其他指令、权限、工具映射和历史。Sonar 沿用相同的受限规则。
- 不修改思考档、请求重试、账号启停、出口、额度或并发。短文本成功不等同于真实长会话与工具往返验收。

English: Extend fingerprint-scoped Codex identity compatibility to Carbon and repeated framework blocks. Preserve instruction priority, permissions, tool mapping, history, reasoning settings and account routing. Live system comparisons do not establish full long-session/tool acceptance.


- 修复后台额度分组：优先使用上游分组 ID 和名称，不再从成员模型说明中猜测分组，避免 Gemini 共享额度因包含 Argon 而显示到错误列。

English: Classify dashboard quota buckets by their upstream group identity and name, rather than member-model descriptions, so shared Gemini quota remains in the Gemini column.

## 1.7.1-bailey.29 - 2026-11-17

- 修复 Sonar 接收新版 Codex 框架时的 system 身份兼容问题：新增 0.169.0-alpha.11.1 取证模板的精确长度/SHA256 匹配，仅规范固定身份开头。
- 处理同时带顶层 instructions 和 developer 指令的请求，保留全部业务指令、权限与原优先级；不修改工具 Schema、历史、用户引用或其他模型。
- 保留原工具映射画像，避免身份兼容引入新的工具别名或参数变化。未知模板继续原样处理。
- 前置同号原出口对照中，约 198KB/11 工具的恢复负载在精确规范后 LOW/MEDIUM/HIGH 均成功接收约 47.7K 输入 Token；这不等于所有 429 原因均已消除，不作账号安全保证。

English: Normalize only the fingerprint-verified model-identity paragraph of the captured Codex 0.169.0-alpha.11.1 framework for Sonar. Preserve top-level instructions, project rules, permissions, tool mapping and conversation history. Other model routes and unmatched templates remain untouched. Prior isolated full-load comparisons succeeded at all three supported reasoning levels; this is a bounded compatibility fix, not a universal rate-limit or account-safety guarantee.

## 1.7.1-bailey.28 - 2026-11-17

- Sonar 开放 low、medium、high 思考档（数字 1、2、3），默认仍使用目录 LOW；通过 Chat、Responses、Anthropic 的标准 effort 字段传递，无需修改客户端代码。
- 两类模型目录公布可选三档与默认思考配置，移除 Sonar 的固定 LOW 声明；其他模型固定档、真实能力上限保持。
- Sonar 的 XHigh/100、MINIMAL/4 及未知档位在本地返回 400，不触发账号派发、重试或冷却；none 仍仅控制思考输出。
- 保留后台、账号调度、出口、额度/并发、缓存、工具签名和原生传输。本次实测证明 MEDIUM/HIGH 参数可接受，不宣称推理强度或账号安全保证。

English: Enable selectable low/medium/high reasoning for Sonar through standard Chat, Responses and Anthropic effort fields, keeping LOW as the default. Publish selectable capabilities and reject unsupported effort locally before dispatch. Other fixed model contracts, signatures, cache, scheduling and transport remain unchanged. Parameter acceptance does not prove reasoning-strength differences.

## 1.7.1-bailey.27 - 2026-11-17

- 选择性移植 LeeFeee 2.1.3 的动态模型目录元数据。Sonar 通过账号实时目录读取模型 enum、LOW 思考档和能力上限，保留原模型 ID；工具调用及签名沿用既有通用往返链路。
- `/v1/models` 两种目录视图同时返回固定思考设置、真实上下文/输出上限与媒体能力；未知或无档位证据的模型不再声明任意 low/medium/high。保留本分支模型参数覆盖和 Hydrogen XHigh 的数字 enum 100。
- 移植已识别的思考型自动判定请求输出预算修复，避免 64 Token 在生成真实结束标签前耗尽；普通请求预算保持，判定预算不超过模型上限。
- 保留独立后台、额度/并发/出口与轮换策略、.26 缓存修复及账号签名隔离。无需修改客户端配置。

English: Selectively align LeeFeee 2.1.3 dynamic model metadata and bounded classifier output handling. Sonar uses live account metadata without aliasing another Hydrogen tier. Expose actual fixed reasoning/media capabilities and limits, retain numeric XHigh enum 100 and local overrides, and preserve cache, signature, manager and scheduling behavior. No client patch is required.

## 1.7.1-bailey.26 - 2026-11-17

- 修复流式累计 usage 后续片段省略缓存/思考字段时，将已报告计数覆盖为零的问题；明确零值仍覆盖，不累加累计快照、不取最大值掩盖修正。
- 识别客户端独立线程标识，隔离原生会话与 Responses 所有权；保留根会话的账号路由亲和及既有根会话状态。
- 为未传线程 ID 或共用 cache key 的未知客户端，按完整历史前缀有界保存时间戳等元数据，保持交错历史和重启后的旧消息前缀。索引最多 2,048 项 / 512 KiB，仅保存哈希及元数据，不保存用户原文、不跨账号复用签名。
- 修复均在网关内完成，不要求修改 OpenCodex、DSH、Hermes 或其他客户端。额度兜底、并发、出口和 20/5 次轮换保持；隐式缓存仍由上游决定，不承诺固定命中率。

English: Merge only present cumulative usage fields, isolate explicit child-thread state and response ownership, and preserve exact-prefix metadata across interleaved histories and restarts using a bounded account-private index. No client patch is required. Quota reserves, concurrency, egress, rotation and signature boundaries remain intact; implicit upstream cache hits are not guaranteed.

历史版本 `1.7.1-bailey.25` 的说明如下。当天 `.10` 到 `.21` 的逐条记录保留完整改动历史；面向使用者的版本说明见 [GitHub Releases](https://github.com/baileyh8/antigravity-gateway/releases)。

## 1.7.1-bailey.25 - 2026-11-16

- 对照官方 CLI 1.5.9 / cl1021519450 的 Mac/Linux 隔离直连抓包更新传输：模型 HTTP/1.1、OAuth HTTP/2，按模型保留实测思考参数；不将别名回落或未完成捕获算作成功。
- 感谢 LeeFeee v2.0.5：移植直接字段/完整 JSON 双视图、namespace/custom 工具、严格回执与参数校验，保留客户端执行、权限与并行约束。
- Schema 使用有界 worker，默认 1 个，队列 32 项 / 8 MiB，空闲 30 秒释放；转换错误不冷却账号、不跨账号重试。
- 保留独立后台、Chat Completions、账号调度和固定出口、额度/并发策略、Hydrogen 最终出站签名补验和账号文件归属修复；支持 `.24` 已签名/无签名持久化缓存迁移。
- 修复 Responses SSE 初始工具参数重复、截断/过滤被误报完成，禁止执行未完整结束的内部生图调用；保留流式回压、缓存/推理用量和上下文溢出语义。
- 保留用户 system/SOUL/项目规则，只处理精确框架证据，工具旁白默认关闭。协议对照不等于所有客户端完成实网验收，也不是账号风控保证。

English: Align the captured CLI 1.5.9 transport and model settings; selectively port LeeFeee 2.0.5 reversible tool contracts and bounded worker validation. Preserve this fork's admin, scheduling, quotas, proxies and Hydrogen signature/ownership fixes, including `.24` persisted-cache migration. Correct stream argument/termination semantics and keep conversion failures separate from account health. Capture, CI, live inference and deployment remain separate acceptance gates.

## 1.7.1-bailey.24 - 2026-11-13

- POSIX root维护/续期原子写入保留原账号文件的uid/gid；新文件继承账号目录归属，失败时不替换旧凭据，防止0600凭据变为root所有后服务无法读取。
- 修复长会话恢复无签名原生工具缓存时，覆盖此前兼容标记、再次触发缺thought_signature 400的问题。在全部历史恢复和工具映射后检查最终上游请求，不只处理空缓存。
- 精确匹配缓存没有真实签名时，保留客户端显式回传且调用ID唯一的签名；已有真实缓存签名优先，不修改缓存原件，不放宽账号、模型和完整前缀边界。
- 增加Gemini 3及Hydrogen四档在三种协议下的连续五轮/重启/缓存命中回归，并覆盖客户端签名、重复ID与真实缓存优先。

English: Root maintenance writes preserve the service owner of POSIX credential files before atomic replacement. Revalidate signatures after full native-history restoration and tool projection. Unsigned cached steps no longer erase compatibility markers or explicit client signatures. Genuine cached signatures and account/full-prefix isolation remain intact.

## 1.7.1-bailey.23 - 2026-11-13

- 修复网关 Responses / Chat 对外序列化时丢失工具思考签名、入站解析遗漏标准 `extra_content.google.thought_signature` 的问题；流式、非流式和自定义工具保持签名、调用 ID 与参数的往返。
- Hydrogen Low / Medium / High / XHigh 统一处理旧会话无签名历史：真实签名及精确持久化恢复优先，缺失时仅为每个模型步骤首个工具调用补兼容标记，不伪造上游签名、不跨账号读取私有历史。
- 签名仅接受有大小上限的字符串，不读取工具参数中的同名字段。账号调度、额度保护、并发、代理绑定和 Go/TLS 传输保持。

English: Preserve per-call thought signatures through Responses/Chat serialization, SSE and input normalization. Cover all Hydrogen reasoning tiers for unsigned imported history, preserve genuine signatures and account-scoped replay, and bound opaque metadata sizes. Scheduling, quotas, concurrency and transport are unchanged.

## 1.7.1-bailey.22 - 2026-11-13

- 对照官方 agy CLI 1.5.7（cl1019769835）本地隔离抓包升级 HTTP/2 与 ALPN；元数据/同步 RPC 使用固定长度，流式 RPC 保留流式请求体，OAuth Token/Userinfo 也走原生传输。
- 按模型区分思考配置：Gemini/Argon/Claude 5.5 各档使用 LOW/MEDIUM/HIGH；Hydrogen XHigh 保留官方实测的数字 100；GPT-OSS 使用 thinkingBudget 8192。输出上限与模型 enum 有逐模型回放测试；不把模型后缀当成权限。
- 用完整 MCP 参数视图兼容已知和未知客户端。等价文件操作提供新原生文件视图，完整保留命令超时、后台/权限参数、自定义工具、原 system 和项目规则。工具名称、参数、回执及已签名历史能够往返；旧格式有显式回退开关。
- 引入授权代次和凭据字段 CAS 合并，防止迟到刷新覆盖启停/权重或新授权；旧健康隔离在升级时保守保留。存储改用私有文件权限与原子替换。
- 保持上游隐式缓存，过滤显式缓存控制字段，按真实缓存 Token 统计，不承诺固定命中阈值或折扣。调度、额度保留、粘连轮数及并发配置保持。
- 感谢 LeeFeee 上游 v2.0.1/v2.0.2 的账号一致性修复与 HTTP/2 工作，本维护分支已结合独立后台及既有调度做兼容移植。抓包只证明协议行为，合成测试不等于全部模型实网可用或账号安全保证。

English: HTTP/2 and per-model parameters are aligned with captured agy 1.5.7 behavior. Reversible MCP tool views preserve client execution constraints and signed history. Grant-generation CAS prevents stale credential writes. Implicit-cache accounting uses real upstream usage. Upstream LeeFeee attribution and MIT history are preserved; account enforcement and live entitlement remain separate from protocol compatibility.

## 1.7.1-bailey.21 - 2026-11-08

- Remove the retired Robin (Gemini app OAuth) and Gemini Windows channels. Both data directories were empty in production, all Argon models are already served by the Cloud Code pool, and `gemini-4-argon` (bare name) is no longer in the catalog: the family is `gemini-4-argon-high/medium/low/disabled`. Roughly 4,600 lines of channel-specific transport, auth, protobuf, quota and proxy code are gone, and the provider router is now a single-pool passthrough.
- Argon video input now always routes through the Cloud Code fallback path; the task-identity header block from the retired channels is no longer emitted (`taskIdentityOptions` returns an empty object).
- The admin API keeps its `?provider=cloudcode` parameter semantics; `provider=robin` remains accepted-and-rejected exactly as before, so existing callers see no shape change.
- Scheduling, quota reserve, affinity, concurrency and timeouts are unchanged. The unified scheduling suite now covers the single API pool with the same distribution, affinity, reserve and failover assertions previously split across three channels.

## 1.7.1-bailey.20 - 2026-11-06

- Set the default client identity to agy CLI 1.5.2 (`cl=1015175089`). A capture of the official 1.5.2 Cloud Code direct-path ClientHello is field-for-field identical to this transport's, so stating the current release is accurate. The `.19` rollback compared against a gateway-mode handshake this transport never emits; that comparison is superseded by the direct-path capture.
- Version and changelist remain paired and configurable via `ANTIGRAVITY_CLI_VERSION` and `ANTIGRAVITY_CLI_CHANGELIST`.
- No change to tool translation, envelope fields, timeouts, quota, affinity or concurrency.

## 1.7.1-bailey.19 - 2026-11-06

- Revert the default client identity to agy CLI 1.4.2 (`cl=1001591392`) as a temporary measure. This was based on a ClientHello from the official client's gateway-mode endpoint, which sends an ALPN extension this transport does not. Stage 0 later showed that endpoint is unrelated to the Cloud Code direct path this transport uses, so the rollback was unnecessary; `.20` restores the current identity. The earlier `boringcrypto` explanation was also wrong: `crypto/tls` has no boringcrypto build branch.
- Version and changelist remain configurable as a pair.
- No change to translation behaviour, timeouts, quota, affinity or concurrency.

## 1.7.1-bailey.18 - 2026-11-06

- Fix a 502 introduced with the semantic layer. A client declaring an `offset` but no `limit` was given a native declaration that still advertised `EndLine`. The model then produced `EndLine`, which has no field to map back onto, so the reverse translation rejected a legitimate upstream call with `invalid_tool_arguments`.
- `EndLine` is now offered only when the client can receive an end position, meaning its rule actually maps a parameter to `EndLine`. Declarations with both offset and limit are unchanged.
- No change to which declarations get translated, nor to timeouts, quota, affinity or concurrency.

## 1.7.1-bailey.17 - 2026-11-06

- Add an opt-in mapping trace: `ANTIGRAVITY_TOOL_MAPPING_TRACE=on` logs `profile=... mapped=N/M` per request, and `ANTIGRAVITY_TOOL_MAPPING_DEBUG=on` adds the translation pairs (`open_file→view_file`). Both default to off, so a busy gateway stays quiet.
- The trace is a separate line rather than extra fields on the request-start trace: the adapter only exists after normalisation and media resolution, so the decision is not known when that line is written.
- Document the native tool scope in the semantics module so the unmapped tools read as deliberate. `grep_search`, `find_by_name`, `list_dir`, `search_in_file` and `read_url_content` are known by name but their parameter objects are assembled at runtime and are absent from the client binary; `send_message`, `schedule`, `invoke_subagent`, `define_subagent` and `manage_subagents` drive Antigravity's own subagent runtime, which a passthrough gateway does not provide.
- No change to which declarations get translated, nor to timeouts, quota, affinity or concurrency.

## 1.7.1-bailey.16 - 2026-11-06

- Add a `search` family mapped onto the captured native `search_web` declaration, which takes `query` plus an optional `domain`. Clients declaring `web_search`, `search_web`, `google_search` and similar now translate, and a query argument is now a recognised role.
- Recognise `patch` as an edit alias. Its shape was already accepted as an edit, but the name was missing from the alias list, so a profile-less client declaring the single most common patch tool name was refused.
- A search declaration carrying an argument outside the family is still declined, and `str_replace_editor` is no longer listed as an edit alias: it is a multi-command tool whose shape the family check rejects, so advertising the name only misleads.
- Free-form patch tools stay untranslated. A single patch string has no native counterpart: `replace_file_content` replaces one contiguous region, so mapping a multi-file diff onto it would silently drop edits.

## 1.7.1-bailey.15 - 2026-11-06

- Fix the reported tool count. The gateway injects its own internal image tool before translation, so `tools` counted one more than the client actually declared and the fraction disagreed with the mapping count beside it. Internal tools are now excluded, making `mapped=N/M` mean N of M client declarations.
- No change to which declarations get translated.

## 1.7.1-bailey.14 - 2026-11-06

- Let a single semantic family qualify when the declaration carries enough evidence, instead of requiring two families unconditionally. A client that declares only one tool used to get nothing even when that tool was an unambiguous file reader.
- The stricter evidence is: at least two declared arguments, and a tool name from that family's known aliases. A one-argument declaration is indistinguishable from a custom tool and stays as submitted, and so does a two-argument tool with an unfamiliar name.
- Names are only a secondary filter here, never a primary signal: a declaration still has to pass the full role classification and the bijection check before the name matters.
- No change to the two-family path, captured profiles, timeouts, quota, affinity or concurrency.

## 1.7.1-bailey.13 - 2026-11-06

- Translate tool declarations by argument shape when no captured profile matches. A client the gateway has never seen now gets `read`, `write`, `edit` and `exec` mappings if its declarations have the right parameter roles and types, instead of falling through untranslated.
- Every inferred mapping must pass a bijection check before it is created: the mapped parameter set must equal the declared set exactly, targets must be unique, and every required field must be covered. A partial map is dropped rather than created, because it would rename or lose a field on the way back.
- A contested native name is never resolved by picking a winner. Two declarations that would become the same native tool are both left alone, and a native name the client already declared is never shadowed. The previous code silently let the later declaration overwrite the earlier one.
- A captured profile stays authoritative: when one matches, the semantic layer does not run at all. If a known client's declaration fails its captured check, the answer is to leave it untouched, never to reinterpret it by shape.
- Without a captured profile, two distinct families are required. One family can be matched by accident; two is the evidence threshold. `ANTIGRAVITY_TOOL_SEMANTICS=off` restores strict passthrough.
- The request log now records `tools` and `mapped` counts per request, so "not recognized" and "recognized but declarations did not match" are distinguishable after the fact.
- No change to timeouts, quota reserves, affinity limits, concurrency, model discovery or the captured profiles themselves.

## 1.7.1-bailey.12 - 2026-11-06

- Fix the Codex profile still not matching real relayed traffic. A local provider proxy forwards `originator` only when the provider opts in through `forwardClientHeaders`, and it drops `session-id` because that name is not on its forwardable list. The previous build required both headers, so the profile was unreachable for every relayed request even after the user-agent check was relaxed.
- `originator` alone now selects the profile, and it accepts every value the Codex surfaces emit: `codex_exec`, `codex_cli_rs`, `codex_app`, `codex_work_desktop`, `Codex Desktop`. `session-id` is no longer required; when it is absent, conversation identity falls back to the existing transcript seed.
- A missing `session-id` only weakens conversation reuse, never translation: `supported()` still decides per declaration. No change to timeouts, quota reserves, affinity limits, concurrency or model discovery.

## 1.7.1-bailey.11 - 2026-11-06

- Recognize Codex behind a local provider proxy. `originator: codex_exec` plus a non-empty `session-id` on a Responses request now selects the Codex profile even when the relay replaces `user-agent` with its own runtime string (for example `Bun/1.4.4`). Previously that replacement silently dropped the whole profile, leaving `exec_command`, `write_stdin` and `view_image` untranslated for the largest request segment.
- Add a DeepSeek Harness profile. `deepseek-harness/<version>` plus one complete captured system-prompt section and one exactly captured declaration selects it; `read`, `write`, `edit` and `bash` then translate to `view_file`, `write_to_file`, `replace_file_content` and `run_command` with their native field names.
- Translate only the captured dsh sentences that name a mapped tool. User messages, project rules and shell examples keep their literal wording, and a declaration that merely resembles one of these names selects nothing.
- Map dsh sandbox escalation onto the native boolean. Its default sandbox already permits workspace writes, so only the wider `danger-full-access` target becomes an unsandboxed request. No change to timeouts, quota reserves, affinity, concurrency or model discovery.

## 1.7.1-bailey.10 - 2026-11-06

- Align the default Cloud Code client identity with the official agy CLI 1.5.1 build: `antigravity/cli/1.5.1 (... cl=1014269460; auth_method=consumer)` replaces the stale 1.4.2 / `cl=1001591392` pair. Community reproductions show a stale pair can hide Gemini quota groups and trigger upstream 404s.
- `ANTIGRAVITY_CLI_VERSION` and `ANTIGRAVITY_CLI_CHANGELIST` are configurable and must be changed together. `os_type` and `arch` still come from the runtime and `ANTIGRAVITY_DIRECT_USER_AGENT` still takes precedence.
- No change to timeouts, quota reserves, affinity, concurrency or model discovery. The native Cloud Code transport already strips the `Accept` header, so no header change is needed.

## 1.7.1-bailey.9 - 2026-11-04

- End admitted Responses streams with a standard `response.failed` carrying `request_timeout` on the overall request deadline, retaining response identity, event sequence and delivered partial output. Empty and buffered tool streams receive the same explicit terminal instead of an ambiguous EOF.
- Record effective failure status and error code after streaming headers have been sent; a timed-out SSE is classified as 504/request_timeout rather than a successful HTTP 200, and subsequent abort handling preserves that cause.
- Make Responses terminals final so late deltas, abort errors or provider completions cannot append a second result. Preserve the existing 300-second deadline, account routing, quota reserves and capacity limits.

## 1.7.1-bailey.8 - 2026-11-04

- Reserve 10% of each valid five-hour quota window and 5% of weekly quota. Both Cloud Code and Robin/Windows guards cover sticky, queued, image, local fallback and unfinished native-task dispatch; past reset windows no longer block. Unknown window labels retain the legacy 5% floor.
- Prefer larger remaining usable quota for new sessions and rebalancing. Compare the tighter normalized headroom first, then the other window; complete readings precede partial and unknown data. Equal balances rotate by configured account weight regardless of reset time. Weekly-only Argon uses its actual weekly reading.
- Preserve 20/five-turn affinity, task ownership, disabled-account exclusion and existing execution, queue and memory bounds. No new dependencies or network I/O on selection.
- Management overview adds per-window reserve percentages and the `remaining_headroom` selection policy. The legacy `reservePercent` field remains the minimum fallback floor; use `reservePercentByWindow` for the effective 5h/weekly policy.

## 1.7.1-bailey.7 - 2026-11-03

- Limit account affinity to 20 successful model requests, shortened to five when any valid quota window in the requested group has 20% or less remaining. Gemini, Claude/GPT and Argon retain independent bindings and counters; the fixed five-hour deadline and 5% reserve remain effective.
- Prefer another compatible idle account at the turn/time limit, including image account preferences; reuse the original only when no alternative can run above the reserve. Reserve in-flight turn budget before dispatch, recheck queued admission, count successful tool continuations and ignore failed/cancelled attempts. Late completions cannot restore an older binding.
- Keep unfinished Robin/Windows native tool tasks on their owner until complete, while still rejecting new dispatches at the 5% reserve. Expose the effective affinity policy in management overview.
- Persist counters in the existing bounded 2,000-session registry with one batched-save timer per pool and a graceful-stop flush. Preserve legacy bindings with zero historical counts; an abrupt crash can lose the final one-second save interval. No new dependencies or capacity changes.

## 1.7.1-bailey.6 - 2026-11-03

- Reserve the last 5% of each model group's reported five-hour and weekly quota. New dispatches, affinity, queued work and last-resort selection cannot use an account at or below the reserve; unrelated model groups remain independent.
- Keep known low readings protected through cache expiry until their own reset or a newer reading. Held Robin/Windows tool tasks retain account ownership and return `quota_reserve_reached` instead of migrating or consuming the reserve.
- Refresh active-account quota summaries at one-minute intervals, or 15 seconds when the selected group has 20% or less remaining. Coalesce and throttle metadata requests without adding per-request timers or changing execution capacity. Management overview exposes the effective quota policy.
- Protection uses upstream telemetry. Already running requests and delayed or unknown readings prevent an exact final-balance guarantee.

## 1.7.1-bailey.5 - 2026-11-03

- Keep Responses tool-output attachments exclusively in native media parts. Remove attachment blocks from the accompanying JSON text while preserving other structured output and literal strings, avoiding Base64 duplication in long multimodal conversations.
- Classify Cloud Code input-token overflows as `context_length_exceeded` request errors. Return HTTP 400 before streaming, or a standard nested `response.error` in `response.failed` after streaming starts, preserving response IDs, event sequence and partial output.

## 1.7.1-bailey.4 - 2026-11-02

- Support retiring the legacy environment client key while retaining multi-key authentication. Admin model probes use short-lived, single-model keys removed on success and failure, independently of client credentials.
- Preserve upstream LeeFeee attribution, existing client key identities and scoped usage attribution.

## 1.7.1-bailey.3 - 2026-11-02

- Schedule Gemini, Claude/GPT and Cloud Code Argon using their own quota groups; Robin/Windows Argon keeps its native GXU group. Round-robin weights are independent per group; expired reset windows do not become false zero quotas.
- Share five inference slots per account across models, with 60 total execution slots, 120 queued requests across admission stages, and a cumulative 30-second queue budget. Busy affinity accounts can switch before dispatch; unfinished Robin tool tasks keep their owner.
- Reserve account and global slots atomically. Dispatch the oldest runnable waiter so saturated models cannot block unrelated free accounts. Release reservations on every success, failure and cancellation.
- Keep image/media sublimits at four. Open initial SSE streams only after execution admission so initial queue overflow/timeout can return HTTP 429 with Retry-After.
- Verify boundaries with synthetic providers, not upstream account capacity probes. These settings are configured ceilings, not an upstream capacity guarantee or 100MB memory limit.

## 1.7.1-bailey.2 - 2026-11-02

- With sincere thanks to LeeFeee and all contributors to [LeeFeee/antigravity-gateway](https://github.com/LeeFeee/antigravity-gateway). This is a maintained fork direction built on that project; original MIT copyright and history remain intact.
- Include the independent `manager/` application: dashboard, accounts/proxies, Gemini/Claude-GPT/Argon quota groups, usage/cache metrics, request/diagnostic/audit logs, model discovery/settings, API keys and password settings.
- Keep inference, credentials, key validation and scheduling in the proxy core. The separate Node management service accesses a loopback versioned API; Next.js exports static pages under `/admin`.
- Add compact two-decimal K/M/B metrics, thin bars, smooth curves and hover/tap chart details, unified masked-email labels, CSRF/Origin checks, conditional reads and bounded log scans.
- Match dashboard metric icons to their meaning and add the antigravity-gateway application title. Make the cancelled-backoff test deterministic under loaded CI timers.
- Add current-build screenshots with synthetic data and independent installation documentation. npm core installs do not pull frontend build dependencies.

- Exclude the four unused tab/chat internal IDs and the retired Gemini 2.5 Pro from discovery listings and exported catalogs; model smoke tests use the upstream default output configuration instead of an invalid universal 32-token cap.
- Split out the legacy built-in panel, its assets/access policy and `/dashboard/*` management routes; preserve the separate loopback admin API, account/proxy/OAuth logic and terminal usage summaries.
- Remove the browser-only html2canvas dependency and its exclusive transitive packages. `stats` now prints local usage instead of launching a browser.
- Retain provider validation, credential redaction and proxy safety tests on the new admin API; reject invalid/repeated account-provider selectors.
- Upstream review through 54ae06e (v1.7.2): no wholesale merge; its OAuth hardening is a separately assessed candidate, not included by this removal.

## Unreleased — 1.7.1-bailey.1

- Display the separate Gemini 4 Argon quota group by name and keep long quota descriptions from squeezing its heading.

- Integrate upstream through db939d4: native transport/client adapters, Windows credentials, shared scheduling, Robin tool-history continuation, cancellation isolation, runtime cache-prefix and lease/drain fixes.
- Route native Cloud Code helpers through the bound account proxy, independently per endpoint, and preserve fail-closed proxy handling for Windows accounts.
- Preserve async streaming backpressure and media writes; generated file extensions and disk budgets now agree across sync and async paths.
- Retain Bailey onboarding, resource budgets and original account stores. No production deployment or release is implied.


- Expose sourced Argon context/output and modality metadata in the standard model list used by DSH; distinguish published API specifications from unverified Robin transport limits. Remove generic Argon reasoning-level defaults.

## 1.5.1-bailey.1 - 2026-10-16

- Integrate upstream Gemini App/Argon with provider-scoped HTTP and HTTP/2 account proxies; missing bindings fail closed.
- Add protected dashboard onboarding for local-browser authorization of a VPS: proxy selection, validated pasted callback, cancellation, status recovery and automatic binding/capability checks.
- Preserve Bailey media concurrency, byte budgets, SSE backpressure, usage detail and shutdown draining. Bound retained Robin tasks and remove uploaded Base64 copies.
- Adopt attachment/Data URL fixes, DSH identity headers, diagnostic redaction and standard opt-in Chat streaming usage.
- Replace identity-bearing terms errors with sanitized guidance. Upstream live acceptance is not deployment acceptance for this build.

Bailey Edition is maintained in [baileyh8/antigravity-gateway](https://github.com/baileyh8/antigravity-gateway). Entries before the Bailey versions retain the original project history.

## 1.2.0-bailey.2 - 2026-10-09

- Separate image generation/editing and native image-tool calls into a four-request pool; image/video/file input turns and uploads share an independent four-request pool. Existing direct model request concurrency remains 12.
- Reserve shared memory before buffering resolved inline, remote or stored media; the default 512 MiB estimate returns 503 on exhaustion and releases reservations on completion or failure.
- Expose pool activity, queues and memory reservations in authenticated dashboard data. Queued image/upload requests no longer hold body-admission slots while waiting for their dedicated pool.
- Verified 252 tests locally and on Linux, four simultaneous uploads, and live four-way generation alongside four mixed image/video inputs.

## 1.2.0-bailey.1 - 2026-10-09

- Establish the independently maintained Bailey line based on upstream 1.2.0, retaining narration, streaming, usage and image-delivery compatibility repairs.
- Add per-account HTTP/HTTPS proxy management, masked dashboard controls and persistent bindings used by token refresh, quota and model/image traffic.
- Cancel discarded 401 response bodies before refresh/retry; preserve unsaved usage on write errors with bounded retry; drain requests before shutdown flush.
- Add asynchronous media I/O, streamed downloads, SSE backpressure, HTTP-body and response-cache memory estimates, optional media disk ceilings, and hashed session alias keys.

## Upstream history (not Bailey deployment acceptance)

## 1.7.1 - 2026-10-21

- Fix macOS Robin tool continuations getting stuck in repeated 409 errors after a native stream closes, expires or is lost on restart. A new client request containing the matching assistant tool calls and results can start a fresh upstream query with that supplied history. The gateway does not execute tools, invent continuation prompts or automatically retry model generation.
- Keep live tool receipts on their original native stream. Reject orphan receipts without portable history; preserve caller isolation and reject ambiguous ownership. An expired anonymous binding no longer blocks a self-contained request.
- Separate Robin no-tool auxiliary requests from the same client's tool task by declared protocol fields, without guessing intent. Preserve Cloud Code and Windows routing, account rotation and quota policies.
- Close both native streams on an empty response and record privacy-preserving failure/re-forward diagnostics. Add ten regression tests; all 714 local tests pass. Actual Claude Code validates controlled Robin connection loss, gateway restart before receipts, and the existing Cloud Code Flash High route, with one command execution per task.

## 1.7.0 - 2026-10-20

This release combines Cloud Code request translation and macOS Robin client adapters. Preserve client-owned permissions, tool execution and task/retry decisions; the default remains the gateway's bounded transport retry policy. The explicit agy recovery policy is opt-in. The combined local suite has 704 passing tests.

### macOS Robin client adapters

- Extend captured Claude Code, Codex and Hermes client capability profiles to the macOS Robin Provider. Reuse reversible tool names/parameters inside the existing external_client MCP catalog and ExecuteRemoteTools stream, without Cloud Code envelopes, agy identity, signatures or toolAction/toolSummary fields.
- Preserve custom SOUL, project rules, permissions, raw custom patches and unknown capabilities. Translate typed assistant tool history without replacing user prose or tool-result bodies. Pin the adapter to the active native task, including follow-ups that omit tool definitions.
- Correlate receipts with the actual client call and original native stream. Reject conflicting IDs, mismatched explicit result names and invalid mapped arguments; do not replay completed calls. Keep existing lost-stream errors rather than reconstructing or executing an abandoned task.
- Add 18 focused regressions; the complete local suite now has 704 passing tests. Existing Cloud Code, Windows, account rotation, quota, dashboard and Argon video-routing regressions remain covered. Actual CLI and raw Robin wire evidence are recorded in docs/robin-provider.md.

### Cloud Code request translation

The entries below retain the development-stage sequence, newest first. Earlier test counts, pending work and recovery experiments describe those stages; they do not override the final behavior and boundaries above.

- Complete the scoped local acceptance audit: three actual clients, reversible native tool calls, signed context/restart continuity, and 18 explicitly checked critical regressions within the Cloud Code stage's 686 passing tests. Match its 69 packaged runtime files to source and formal isolated installation. Unknown or non-equivalent capabilities remain compatible; no Google-internal indistinguishability is claimed. See docs/agy-acceptance-matrix.md.
- Recognize Hermes framework blocks independently of user SOUL and project context. Translate the separately captured coding brief while preserving real permissions, user text, paths and runtime hints. Correct a quoted `mode='patch'` value accidentally treated as a tool name, and omit the captured obsolete mode hints absent from the actual executor schema. Ordinary rules-enabled Hermes CLI before/final tests complete 14 Google responses, tools and restart/resume; the failed intermediate fidelity sample is retained separately. Six additional regressions bring the total to 686; only agy-hermes-profile.js changes at runtime in this final stage.
- Add the actually captured Hermes 0.21.7 Chat template and read_file/view_file, write_file/write_to_file, patch/replace_file_content, terminal/run_command translation. Match full fixed-template and declaration fingerprints, not generic OpenAI headers; do not invent session IDs. Preserve fuzzy edits, write guards, inclusive read ranges, terminal timeout seconds, persistent environment and notification unions. Rewrite only captured framework references; keep user/project content, deferred tools and unknown templates unchanged. Actual isolated Hermes CLI before/after formal installs each complete file tools, shell execution and restart/resume: 14 complete Google requests, 24 matching stable TLS captures, 680 local tests, 69 matching runtime files. Custom SOUL/toolset template variants and remaining final coverage are not yet verified.
- Recognize captured Codex CLI 0.159.2 Responses metadata locally and add reversible exec_command/run_command, write_stdin/manage_task and image-only view_image/view_file mappings. Preserve exact commands, working directories, wait/output limits, approval requests and numeric sessions; do not claim task list/kill or text-file capabilities. Keep the apply_patch custom grammar unchanged. Actual before/after packaged CLI runs verify same-reply command calls, gateway restart before receipts and native patch execution; an additional real run verifies status, stdin, process completion and exact image-byte return. Thirteen complete Google responses, 672 local tests and 68 matching runtime files. No pool, routing or dashboard behavior change; Hermes and remaining fixed templates are pending.
- Extend the captured Claude Code profile to Edit/replace_file_content and Bash/run_command. Preserve exact replacement and command strings, optional defaults, execution limits, background flags, UI descriptions and sandbox requests; do not conflate timeout with async scheduling or background work with daemon lifetime. Translate known declaration references while retaining client permission and execution constraints. Do not add unavailable line scopes, Cwd or persistent-terminal controls. Formally installed before/after packages complete actual Claude Read/Edit/Bash and gateway-restart workflows: twelve complete Google requests with exact signed history and receipt correlations. 664 local regressions pass. Only the tool-adapter runtime module changes in this stage; other clients and live background execution remain unverified.
- Clarify the gateway/agent boundary: default back to the original bounded transport retry policy. Do not silently continue failed model turns or reject agent retries using old hidden terminal state; retain the existing explicit agy policy only as an opt-in compatibility option. Preserve complete committed tool calls for their actual client executor. Add capability-checked Claude Code 2.1.285 Read/view_file and Write/write_to_file bidirectional adapters, named-tool selection and identity-line translation, with exact issued-call projections for signed histories and receipts after restart. Preserve line/PDF/write semantics and unknown tools, versions and collisions rather than advertising unsupported native features. Actual formally installed Claude Read/Write/restart passes; one controlled disconnect verifies Claude itself issues the replacement API request without a synthesized continuation user. 658 local regressions pass. Other client/tool profiles remain pending; account pools, routing and dashboard are not rewritten.
- Preserve complete signed client-tool SSE events across captured Flash High read failures, including before STOP; do not dispatch an unterminated data line. Deliver the actual call once, retain its exact signature, and insert the native recovery user only after matching real client receipts, bound to identity/session/model/full history. Share retry/backoff state across successive tool interruptions. At failure nine, retain the call/result without another recovery user or automatic Google request; reject identical terminal receipts locally with one non-retryable 400 and allow a new user turn. Real official agy and formally installed Claude validate normal, consecutive, terminal and restart paths. Retain the failed hot-reloaded injector sample separately. 649 regressions pass; 66 installed runtime files match. Both two-tool live runs were serial, not parallel-tool proof; no full-fingerprint or all-platform claim.
- Retry captured Flash High SSE read failures before parsed model content within the same logical request: increment only the error step, preserve the exact payload, and share the nine-failure/backoff budget with HTTP errors without inventing continuation history. Real official CLI pure/mixed runs establish the limit; actual formally installed Claude verifies 4016ms versus the official 4015ms first retry and restart/recall. Separate later SDK retries and five local account-cooldown rejections from upstream attempts. Preserve two confounded injector runs as excluded limit evidence. Complete signed tool-call/STOP delivery followed by transport failure remains an observed, unfixed difference. 640 local regressions pass, 66 installed runtime files match; no all-platform or indistinguishability claim.
- Reject identical terminal model-ended retries locally with non-retryable 400 instead of 409: two real formally installed Claude runs stop after one local rejection rather than ten, retain partial output and resume on a new user turn without an invalid Google request. Fresh actual agy/Claude SIGINT captures during stream recovery identify Claude's synthetic cancellation message pair; translate it only for the captured client profile and an identity/model/full-prefix-bound observed client cancellation. Preserve arbitrary text, unknown clients, edited histories and timeout/HTTP semantics. Actual before/after restart requests change 1/3/7 to 1/3/5; official 1/3/6 includes its own real background notification, never fabricated by the gateway. Raw SSE establishes the previous ~300s failure as the unchanged gateway deadline, not Google 504. 635 regressions pass; full cross-platform/model verification remains open.
- Extend captured Flash High read-stream recovery to pure chat; persist one shared HTTP/read-failure count and use its backoff index, avoiding resets and an extra tenth automatic request. Preserve native terminal partial text without fabricating another continuation user; identical model-ended client retries are rejected locally with 409 until a new user message arrives, rather than provoking the observed Google 400. Keep actual streamed thinking in the final local aggregate so it is not replayed after the answer (real intermediate Claude runs otherwise returned empty results). Four fresh official groups and old/intermediate/final formal packages retain all failures: final thought and mixed-retry Claude runs pass, but one final visible-recovery answer times out at ~300s; the same session resumes correctly. SDK retries of local 409 remain an interaction limitation. 630 regressions pass, 66 runtime files match the formal package; no full-fidelity/all-platform completion claim.
- Recover the captured Flash High tool-result SSE read failure inside Cloud Code: retain actual partial text, discard unfinished thought history, append the exact native interruption message, and advance two steps plus one logical request. Keep bounded identity/session/model/full-prefix private recovery projections separate from ordinary model-only projections; persist before backoff and preserve restart/cancellation without phantom dispatches or arbitrary user-history insertion. Fresh official nine-disconnect capture establishes eight continuations and a distinct terminal error without a ninth continuation message. Actual formally installed Claude Code verifies visible/thought-only cuts, single real Read execution, no SDK fallback retry and restart/recall with steps 1/3/5/7. 623 regressions pass. Preserve legacy settings and unmeasured no-content/half-tool/checkpoint/other-model transport behavior; this is not complete network-fault or all-platform equivalence. The earlier uncorrected capture remains as the before evidence.
- Bind managed Cloud Code private history to the saved Google subject, normalized email fallback or identity-less grant, in addition to the local account ID. Actual same-ID credential replacement previously restored a different identity's private answer signature/trajectory; the new formal package starts independent state while preserving known-identity token refreshes and caller-supplied tool signatures. Do not migrate unbound legacy caches; submitted client history remains authoritative. Real before/after Google requests and actual Claude Code Read/replacement/restart pass; 611 regressions pass. This is a local namespace change, not a new upstream field or a change to account IDs, credentials, scheduling, Robin or Windows.
- Validate the same formally installed package with two actual Cloud Code accounts: new-session selection, distinct clients sharing a raw session ID, private answer-signature isolation, owner-only injected 429 failover, and gateway restart/resume. Actual Claude Code performs Read and resumes successfully on the second account; its explicitly echoed tool signature is preserved, not mistaken for private-cache leakage. Twenty captured inference requests comprise eighteen complete Google 200 responses and two clearly local faults; a failed readiness harness that made no inference is retained separately. Seventy-seven raw ClientHellos match the captured stable profile. Caller system instructions, tool capabilities and explicit output limits remain observable differences. No runtime change or all-platform/Google-internal indistinguishability claim is made by this validation.
- Align default Flash High HTTP retry scheduling with actual agy 1.4.2 captures: nine agent attempts with downward jitter, five one-second checkpoint attempts, and the same endpoint throughout. Distinguish ignored HTTP Retry-After from typed 429-body RetryInfo (9s respected; 31s terminates for account-pool handling). Preserve explicit legacy knobs, unobserved models/statuses/transport exceptions and independent image/Gemini App paths. Fresh official CLI, before/after formal packages, backoff cancellation and real Claude Code Read/restart/resume verify this scope. 605 regressions pass; randomized values and Google-internal indistinguishability are not claimed identical.
- Extend the captured native HTTP-error state rules to actual HTTP 500, 502 and 504 after six new official agy terminal/recovery captures. Agent attempts each consume an error step; checkpoint retries change only the timestamp and consume one step on terminal failure. Preserve retry/endpoint/account policy and do not classify transport exceptions or unobserved HTTP statuses by guessing. Six formally installed before/after comparisons verify the former repeated-step/missing-boundary defects. Real Claude Code Read, controlled tool-result HTTP 502, actual Google 429 recovery and restart/resume retain the original call/answer signatures. 594 regressions pass; full temporal fingerprint equivalence remains open.
- Correct checkpoint retry, terminal-failure and cancellation state from eight fresh actual agy scenarios, with formally installed before/after comparisons. Unlike agent retries, checkpoint 429/503 retries change only the request timestamp; exhausted 400/429/503 failures consume one terminal error step, while early/partial/backoff cancellations consume none and never install partial summaries. Refresh the execution boundary after failure/cancellation and retain only the timeline metadata of completed answers temporarily omitted by Claude. Real installed Claude Code verifies retry recovery and SIGINT during actual partial checkpoint output, followed by gateway restart and same-session recall. 585 regressions pass. Preserve existing account/endpoint failover and retry policy; official samples use five attempts roughly one second apart, versus four gateway attempts with endpoint fallback. Local fault injections, incomplete responses and actual Google responses are explicitly separated; no complete temporal fingerprint equivalence is claimed.
- Map the exactly captured Claude Code 2.1.285 automatic-compaction instruction to a same-trajectory Cloud Code checkpoint, without keyword-based intent guessing or changing Robin/Windows routing. Preserve caller instructions/tools, use the captured 16384 checkpoint cap, keep the agent counter unchanged, and wrap recognized subsequent client summaries in CONTEXT_SUMMARY without rewriting their text. Retain only observed timeline metadata for the completed answer Claude temporarily omits; do not restore removed history or signatures. Unknown versions/instructions/envelopes retain compatibility behavior. Actual unmodified agy long-context traffic demonstrated automatic checkpointing; formally installed real Claude Code before/intermediate/final comparisons and restarts verified the correction. 573 regressions pass. A process-local Claude threshold override triggered the client test without falsifying usage; failed diagnostic attempts are preserved separately. Full cross-platform and overall fingerprint equivalence remain unverified.
- Correct native HTTP framing for the six captured Cloud Code metadata RPCs: emit Content-Length while preserving single-chunk generation and unobserved-path behavior. Raw official wire captures exposed the previous overgeneralization of chunked framing, including its effect on later TLS record sizing on a reused connection. Rebuild all six bundled native targets. In a synthetic-credential local-only exact-byte replay, all ten HTTP wire messages and TLS record-length sequences match after the fix, versus five/four before; no captured request IDs are replayed to Google. Eighteen separate real Google agent requests, including long context, file tools, restart and actual Claude Code, return HTTP 200; 566 Node regressions and native Go tests pass. Controlled TLS-server comparisons do not establish direct-Google record equality, TCP fingerprints or identical connection scheduling.
- Persist captured 400/429/503 agent HTTP error steps as soon as the error is received, including the final failure and cancellation during retry backoff. Save the observed terminal execution boundary across gateway restarts without adding synthetic model/error messages or changing retry limits and account/endpoint failover. Check an already-aborted signal before starting a backoff timer. Fresh official captures, before/after formally installed HTTP comparisons and real Claude Code Read/restart/resume pass; 564 regressions pass. Official terminal 429/503 samples issue nine requests, while the preserved gateway policy issues four. Full retry timing equivalence remains unclaimed.
- Correct the previously assumed single-envelope retry behavior using actual agy 1.4.2 HTTP 503/429 captures. Each dispatched retry advances its native error step and request timestamp, while retaining the logical request counter, cascade/trajectory, content, tools and signatures. Persist that step for later tool results and restart continuation; add no upstream fields or synthetic assistant messages. Preserve existing account/endpoint failover and client recovery behavior; do not generalize to unobserved authentication, transport or checkpoint failures. Formally installed real Google continuations and actual Claude Code Read/resume passed; 559 regressions pass. The controlled fault responses are explicitly distinguished from real Google 429/200 responses, and retry timing/endpoint differences remain documented.
- Verify the formally installed npm package in actual Linux ARM64 and emulated Linux x64 containers: postinstall/native execution, CLI entry points, 63 runtime-file hashes and all 553 regressions pass on each architecture. Capture real local HTTP bytes and ClientHello bytes with no account credentials; stable TLS fields match the existing macOS agy capture. Preserve the initial three environment-related skips, then supply Python/internal networking and rerun with zero skips. This does not establish a native Linux agy baseline, physical x64 host coverage, real Google calls on Linux, or Windows transport equivalence.
- Preserve explicit client tool-failure semantics in Cloud Code using the captured agy `Encountered error in tool execution:` output text. Keep raw error content, media and issued-call order, avoid duplicate native wrappers, and do not invent external execution timestamps or upstream error fields. Ordinary success JSON and Robin/Windows normalization are unchanged. Real permission-denial and missing-file captures establish the native error envelope; permission denial is not claimed as successful execution-cancellation verification.
- Add the real agy JSON-schema `finish` declaration to ordinary object-schema Cloud Code requests on the first attempt. Strip only native terminal metadata from client output, validate against the unchanged client schema, and retain the signed terminal call plus captured completion-result shape through exact private history projection. Preserve client tools, required/named choices, collisions and unobserved root-schema compatibility; do not apply this adapter to Robin/Windows. Real captures exposed the former missing first-request schema and prose repair retry. Detailed live results and limits are tracked in docs/agy-fidelity-plan.md.
- Remove gateway-generated attachment tags and per-parse media IDs from Cloud Code non-image/mixed inputs. Fresh real captures showed those IDs changed an otherwise identical submitted history and prevented native answer-signature restoration. Keep adjacent filenames as ordinary necessary content and preserve MIME/data exactly; do not fabricate a tool call or claim unobserved native direct-upload formatting. Formally installed real Google tests cover WAV/PDF/mixed uploads, video-skill uploads, restart continuations, actual binary client-tool results and Argon-selected video routing through all three public APIs. Fresh official agy WAV/PDF/MP4 view_file captures establish the native tool-result shape. 539 regressions pass; full non-image direct-upload fidelity and other remaining scope are still incomplete.
- Preserve exact native text/tool signatures across the specifically captured Gemini 3.8 Flash High/Medium/Low model IDs, while retaining account/session/full-prefix/content isolation. Fresh official agy runs demonstrated retention through High→Medium→High and High→Low→Medium→Low→High, including a real file read; the former gateway dropped cross-model signatures. Add captured M318/M319/M320 and -1/4000/1000 thinking defaults, subordinate to live catalog metadata. Formally installed real HTTP tests verified all prior signatures across gateway restarts. Do not broaden image receipt projections, other model families or Gemini App routing. 532 regression tests pass; cross-OS and whole-objective verification remain incomplete.
- Persist ordinary text cancellation boundaries using fresh official agy SIGINT/resume captures. No model output means no extra response step; thought-only output consumes a step without replaying unfinished thoughts; received partial text is cached only for exact client-history restoration. Refresh the native last_execution_id after a dispatched text request is cancelled. Do not resurrect omitted partial history, synthesize the official runtime's restart notice, or generalize this path to interrupted tools/checkpoints. Real formally installed HTTP tests covered early, thought-only, partial-omitted and partial-echo cancellation with a gateway restart. Latest regression count: 527 passing; raw official steps include one genuine restart-notice step absent from the gateway.
- Replace stale file-lock reaping with atomically published nonempty directory leases and unique owner markers for Cloud Code state writers and garbage collection. Eight real Node processes reproduced overlapping writes and a lost counter update under the old implementation; both the source and a formally installed package then completed 40 abandoned-lock recovery rounds / 320 transactions without overlap or lost updates. Cancelled contenders clean only their own candidates; dead legacy file locks and abandoned unpublished candidates are handled conservatively. This changes local coordination only, not wire fields. Latest regression count: 522 passing; cross-OS runtime behavior remains unverified.
- Route Cloud Code calls through a bundled, integrity-checked native transport; preserve the separate OAuth, Robin and Windows Gemini paths. Match the captured agy 1.4.2 macOS TLS/HTTP profile, including signature algorithms beyond JA3, chunked framing and header ordering. Ship six platform/architecture binaries, native sources and the Go license without requiring a compiler at install time.
- Separate local routing IDs from native agent request IDs and labels. Persist account/session-scoped response signatures and native history parts, restore only matching history prefixes/model/content, and retain IDs across restarts. Keep logical request identity across HTTP retries while advancing captured 503/429 error steps, serialize same-session requests and release cancelled leases.
- Preserve ordinary answer signatures as well as tool signatures; separate thought summaries from visible output. Send tool results as model-role functionResponse/output, use upstream SSE regardless of downstream streaming, and omit unsolicited Gemini AUTO tool configuration. Prefer observed account model metadata for generation settings.
- Remove the global multimodal identity/system prefix. Keep required image-generation guidance within the image tool declaration and preserve caller system instructions and tool capabilities.
- Serialize tool declarations using the captured protobuf enum casing, field ordering, sorted property/argument maps and one declaration per Tool. Merge separate OpenAI tool-result messages into the native result group without changing the client contract.
- Persist a hash-only context timeline and native step counter independently of message-array length. Count parallel tool results individually; route explicit Cloud Code compaction as checkpoint on the same trajectory, preserve the agent request counter, and continue after a client summary replacement without resetting the step. Preserve original user whitespace, stable USER_REQUEST timestamps and actual model-selection metadata across restarts. Robin/Windows auxiliary routing is unchanged.
- Recognize the actual Claude Code `x-claude-code-session-id` header (including CORS) as an explicit conversation identity, independent of its opaque billing/device metadata. Preserve inline system/developer messages in the system instruction field instead of counting them as user turns. Real Claude Code 2.1.285 against an isolated, formally installed package completed Read → Write → Read and saved-session resume across a gateway restart; the five upstream steps were 1, 3, 5, 7, 9. The existing tool-declared response buffering policy is unchanged and is not claimed to deliver live text deltas.
- Replace pure image/text user attachment markers with the observed agy USER_REQUEST/upload-path metadata and ordered inlineData layout. Persist upload timestamps with the hash-only timeline, save actual private reference files with native single/multiple-image naming, and keep path aliases in local WeakMaps rather than upstream fields. Preserve legacy image references and editing; bound idle reference caching without deleting ordinary uploads or generated artifacts. Actual formal-package tests passed single image, restart/recall with signature restoration, two images, reference-guided editing and real Claude Code Read. Mixed/non-image media remain pending.
- Project the gateway-owned image tool result into the captured native file-result text envelope with separate inline image parts, keeping structured artifact/delivery bookkeeping local. Preserve the public client receipt, and restore its actual hidden native exchange only under an exact account/session/model/history match, including after restart. This private projection stores server-generated parts/images within existing state limits; the context timeline itself remains hash-only. Save generated images using their MIME extension so Claude Code Read returns actual image content; retain legacy generated .bin reads and ordinary upload behavior. A real formally installed Claude Code run completed generation → image Read → Write → gateway restart/resume, with native steps 1, 3, 5, 7, 9 and 512 regression tests passing. Preserve the earlier .bin Read failure/receipt-leak capture as a failed sample. Extra image-tool semantics and the separate image-generation call are not claimed to match a captured official generate_image request.
- Rejoin the real Codex Responses layout of assistant text plus separate function/custom-tool calls into one Cloud Code model step before signature/timeline lookup. Apply an unknown-history signature fallback only after grouping, never to parallel siblings; leave client-normalized messages and Robin/Windows transports unchanged. Real Codex CLI 0.159.2 demonstrated the earlier split-step/sentinel defect, then verified parallel reads, actual custom apply_patch, disk output and gateway restart before tool results. A separate real-HTTP prefix replacement retained only the new history across another restart. Latest regression count: 515 passing. These checks do not establish automatic-compaction, Chat Completions or all-platform equivalence.
- Live macOS checks passed memory/tool/restart/recall, parallel tools and explicit compaction, plus a formally installed package's real Chat Completions request through TLS passthrough. This is partial verification, not a claim of complete agy equivalence; automatic compaction, arbitrary prefix replay, child tasks, other models, media and Windows/Linux runtime verification remain tracked in docs/agy-fidelity-plan.md.

## 1.6.0 - 2026-10-18

- Added an independent Windows Gemini web-session authentication and WebChannel `ProcessSession` transport for `gemini-4-argon`, verified with an actual Windows Node.js request. No invented Windows/Linux surface values, macOS impersonation, or official-app modifications are used by the gateway.
- Reworked as an incremental addition to 1.5.1: `add-gemini` retains the original OAuth behavior on every OS; only `add-gemini-win` selects Windows session login. No OS-dependent reinterpretation of the old command.
- Sign in with the system-installed full Chrome/Edge without debugging or automation flags. After the user closes the dedicated login window, export its cookies from the same browser/profile on a blank page and clean up. No embedded/test browser, headless login, Gemini App patching or automation-hiding scripts.
- Store Windows credentials in `gemini-win-accounts/`, separate from `robin-accounts/` and `accounts/`. OAuth and Windows grants for the same Google account coexist with independent IDs. Reuse the existing scheduler and public APIs; the selected credential type chooses the upstream transport.
- Remove inference probes from account creation and Windows model-list refreshes. Login verifies identity only; actual requests determine entitlement and quota. Expose each Gemini account's transport in terminal account listings.
- Persist and validate account-scoped Google cookies, refresh bootstrap metadata, save returned cookie rotations, pin credential destinations and reject stale results after account replacement/deletion. Existing Cloud Code credentials and scheduling remain separate.
- Support Windows text/streaming and existing schema-validated client-tool compatibility envelopes. This is not Robin's native MCP bridge. Non-video attachments explicitly fail on this new channel; video keeps the existing Cloud Code route. Windows token measurements remain unknown.
- Read five-hour/weekly Windows quota and reset times through the official read-only UsagePageQuery, verified with two real Windows accounts without inference. Persist Windows quota separately from OAuth and reuse the account dashboard. Query failures remain optional telemetry failures; late responses cannot resurrect deleted or replaced credentials. A five-hour reset no longer releases an independently depleted weekly pool.
- Extract the existing Antigravity scheduling policy into one shared module used by Cloud Code, macOS Robin OAuth and Windows WebChannel: fixed five-hour affinity, weekly-pressure and five-hour-reset weighted rotation, advisory exhausted-quota fallbacks, one attempt per account on failover, common retry-delay parsing and a 15-second transient cooldown. Preserve upstream transport, capability and tool-task ownership boundaries. All channels use 30-minute quota freshness/background refresh and five-minute targeted-refresh throttling. The global affinity setting takes precedence; the legacy Robin setting is a fallback alias for all three channels. Add cross-channel sequence, affinity, persistence, cooldown, failover and credential-filtering regression tests.
- Finish WebChannel reads on complete protocol frames instead of waiting for an indefinitely open HTTP channel. Repair an undelivered invalid tool envelope at most once without replaying an executed client tool. Preserve original Robin attachment routing in mixed pools.
- The reused transport was previously exercised with formally installed Windows Claude Code `Read → Write → Read`, saved-session reuse and real Chat Completions tool results. The new ordinary-browser login lifecycle and separate stores have local regression coverage; this rework does not repeat real-account sign-in or consume inference quota and does not claim the revised human-login flow has passed live Google verification.
- The final Windows-specific prompt passed the real Claude Code loop. Subsequent short Chat Completions and Responses probes returned a different upstream model variant and were explicitly rejected; they are not claimed as successful Argon validation. The reason for upstream substitution remains unconfirmed.
- Treat Windows model substitution as temporary unavailability: allow existing account failover only before text/tool delivery, preserve tool-task ownership, and do not label unconfirmed substitution as exhausted quota.

## 1.5.1 - 2026-10-15

- Preserve Gemini App `412` terms-acceptance errors verbatim, append the actual routed account and a Chinese action prompt, and return the error without quarantining or failing over to another account.

## 1.5.0 - 2026-10-15

- Added independent persistent Gemini App OAuth, Argon capability routing, native task/tool streams, quota snapshots and account grouping within the existing gateway and dashboard. Antigravity scheduling and credentials remain separate.
- Exercised Messages, Chat Completions and Responses client tool loops, client/account conversation isolation, native completed-conversation resumption across restarts, image/audio/PDF/text inputs and tool-result images.
- Added opt-in public thought-summary delivery through the shared response formats and streaming events, scoped Auto Mode tasks, and cleanup of native tool waits rejected by the existing client contract validation.
- Distinguish native RUNNING and approval-card responses from completed answers; unsupported native confirmations fail explicitly instead of returning an action-card URL as a finished result. Unknown Robin token usage is explicitly marked rather than reported as a measured zero.
- Bridge typed native MCP confirmation controls in the same conversation while preserving real client tool validation and approvals. Retain active tool channels and return each result on its source connection; reject non-MCP consents, foreign MCP servers, mismatched sessions and repeated control messages.
- Isolate cancellation of shared per-token device registration, cancel preparation when an account provider stops, and prevent generic-MIME attachments from reusing a cache processed as a different native file type.
- Reject foreign-provider credentials even when copied into the wrong account directory, and harden independent Robin OAuth setup, manual headless completion and callback input handling without changing Antigravity scheduling.
- Recover an explicitly running task at clean stream EOF through bounded, owner-validated native reads with message-tree rendering. Preserve tool channels, pause reads while awaiting client results, and never replay prompts or client tools; retain legacy JSON type-marker compatibility.
- Align recovery reads with the existing request timeout instead of a shorter independent cutoff, preserve native saved mode metadata, and retain legacy implicit account IDs for previously ignored export labels.
- Extend bounded diagnostic-log redaction to Robin server-token fields, headers and serialized error text; personal OAuth and server tokens remain outside source and package contents.
- Keep inference and Cloud Code error diagnostics independent of unified Robin catalog refreshes. Preserve exact unknown Cloud Code model forwarding, account-level capability checks, combined model catalogs and explicit ambiguous-provider errors.
- Bound Robin metadata requests, cancel them on provider shutdown and reject cancelled catalog results. Avoid probing quarantined/cooling credentials during ordinary model-directory refreshes, and exclude obsolete account capabilities after deletion or reauthorization.
- Show unavailable Robin token measurements explicitly in account cards, KPIs and charts; mixed-provider token views include only metered accounts while preserving all request/failure counts and native quota snapshots. Keep the existing dashboard stylesheet and persisted measurements unchanged.
- Keep dashboard account mutations Provider-scoped: reject malformed or repeated Provider selectors, reject ambiguous legacy IDs shared by both account pools, and never let a Robin recheck or deletion fall through to the Cloud Code pool. Verified the existing dashboard at 1600, 768, 414, 375 and 320 pixels with synthetic data and no real account operations.
- Surface the empirically verified Gemini App subscription: the authorized Google AI Pro account returns `UserSubscriptionTier.TIER1` (wire value 2), which is persisted and shown as Google AI Pro; every other unverified tier remains unnamed.
- Do not infer Gemini App thinking tiers from unused experimental status-policy records. Remove their discovery, persistence, dashboard display and request encoding; Argon ignores client reasoning controls instead of manufacturing a capability that the app does not expose.
- Route video-bearing Argon requests through the gateway's established Cloud Code multimodal path and configured default model because Gemini App performs local frame extraction rather than reliable native Argon video understanding. Keep every non-video Argon request isolated on Robin and retain the model's existing attachment-versus-generation judgment.
- Reject explicitly Robin-owned models, including configured aliases, on the not-yet-integrated standalone Images operations rather than silently charging Cloud Code. Preserve existing default/Cloud Code image generation and editing behavior.
- Isolate subprocess and Robin model-directory failures in explicit agy/auto modes, keep all client model artifacts unified without requiring a local CLI for Robin, and prevent Cloud Code Auto Mode discovery from querying unrelated Robin credentials. Include discovered Argon in startup model presentation without changing Antigravity account scheduling.
- Preserve exact inline file bytes by unpacking Base64 Data URLs in the shared media layer; support standard nested Chat file objects alongside legacy flat objects and infer generic MIME from the existing filename map. Reject malformed inline Data URLs before provider dispatch without changing credential scope or account scheduling.
- Recognize DSH caller/session headers in the shared identity parser and keep version-independent caller isolation. Partition its explicit compaction requests and no-client-tool requests into independent Robin task scopes while retaining parent affinity and tool-result ownership.
- Preserve Robin in-flight tasks, metadata results and affinity across refresh-token rotations saved by the account's own OAuth provider; continue rejecting externally replaced or restored grants and late results from obsolete authorizations.
- Verified a real DSH Argon file-tool roundtrip with its default title request isolated into a separate native conversation, using permanent OAuth and a nonexistent agy path. Verified correct complex-task delivery beyond the former two-minute cutoff through reads of a single native task rather than prompt replay.
- Isolate anonymous Robin tasks even for identical parallel prompts, correlate only actually issued tool-call IDs within their caller/provider scope, and reject expired/completed or conflicting replies without replay. Treat cache hints as affinity rather than conversation identity; preserve existing Cloud Code selection rules. Verified two actual Pi CLI native Argon tasks with independent file-tool results and covered all three HTTP protocols, including Responses continuation.
- Verified actual Hermes requests without reliable session fields and two concurrent native Argon file-tool tasks returning their own results and final task modes. Kept background auxiliary completion out of that native main-task claim; controlled-client coverage separately exercises those request scopes and teardown.
- Original Robin token usage and remaining client coverage are still under investigation; video deliberately uses the existing Cloud Code path. Release validation includes 413 local regression tests plus real Claude CLI text/tool roundtrips for both `gemini-3.8-flash-high` and `gemini-4-argon`.

## 1.2.0 - 2026-10-06

- Added per-account model-capability routing: the gateway records each account's authoritative model catalog, filters out accounts that do not support the requested model, and then applies the existing affinity, health, cooldown, quota-pressure, five-hour reset, and weight rules unchanged among compatible accounts.
- Added a bounded, redacted authentication diagnostic log for process lifecycle, sleep/resume gaps, token refreshes, account quarantine and recovery, manual rechecks, and upstream authentication probes. The JSONL log rotates at approximately 5 MB and retains one previous file without recording credentials, prompts, or model responses.

## 1.1.0 - 2026-10-01

- Replaced winner-take-all quota routing with weighted distribution across healthy accounts: Gemini weekly pressure bands set the main weight, the nearest Gemini five-hour reset receives an in-band boost, and lower-ranked accounts retain traffic instead of starving.
- Changed persisted soft affinity from a sliding 72-hour lifetime to a fixed five-hour window; healthy continuations now use an O(1) local-state fast path and quota ranking runs only for new, expired, or failed bindings.
- Raised the default direct-transport concurrency from 4 to 12 while retaining 4 for explicit local `agy` subprocess transport; environment overrides remain supported.

## 1.0.1 - 2026-09-30

- Added Gemini-only weekly pressure bands (`floor(log2(remainingFraction / hoursUntilReset))`) before the existing Gemini five-hour reset priority for new bindings and account failover, while retaining soft affinity for conversation and image continuations.
- Corrected weighted rotation so only a real account selection changes weights; unused fallback candidates no longer distort load distribution.
- Added asynchronous per-account quota-summary refreshes with five-minute throttling, request coalescing and bounded concurrency; tracked summary freshness separately from model/plan queries and rejected obsolete results after deletion or credential replacement.

## 1.0.0 - 2026-09-29

- Persisted soft account affinity for 72 hours across restarts, while preserving immediate failover for unavailable accounts.
- Prioritized new and failover account selection by the nearest Gemini five-hour quota reset to reduce unused quota.
- Distinguished transient network failures from account authentication, access-denial, and Google verification challenges; unhealthy accounts are excluded from text, image, model-catalog, and quota traffic and surfaced in the dashboard.
- Added persistent dashboard controls for quota overview/detail display and the selected 1/3/7/30-day statistics range.
- Added dashboard actions to recheck an unhealthy account with a token-free authentication probe and to permanently remove an account together with its credentials, health state, quota snapshot, affinity bindings, and automatic local re-import fallback.

## 0.9.3 - 2026-09-29

- Kept native image-generation continuations and client tools intact while separating the internal structured tool result from the single gateway-owned client receipt, with idempotent delivery across Anthropic Messages, Chat Completions, and Responses.
- Preserved the dashboard tutorial QR code in locally generated share images.

## 0.9.2 - 2026-09-28

- Added an opt-in IP/CIDR allowlist for viewing the complete Token dashboard from other devices while keeping the default local-only behavior.

## 0.9.1 - 2026-09-25

- Added unified generated-image delivery receipts across Anthropic, Chat Completions, Responses, and Images, including structured artifact metadata, Markdown, URL, gateway-local path, and `HEAD` support.
- Bundled a cross-agent video-understanding Skill and dependency-free Python helper that uploads local videos through Files and submits native `input_video` requests without adding another gateway CLI.
- Separated client identity, conversation state, parent-child relationships, request tracing, and account affinity so different agents remain isolated while tool calls and child agents can prefer the parent account without sharing conversation state.

## 0.9.0 - 2026-09-25

- Added native image generation and reference-image editing through the same private Antigravity image request used by agy, without launching the local CLI for each request.
- Added image, video, audio, PDF, and file understanding across Anthropic Messages, OpenAI Chat Completions, and Responses, including a local Files API for remote clients.
- Let the requested Gemini model decide semantically whether an attachment is context or an image-generation reference through a private native tool; there is no keyword intent router, and client tool contracts remain unchanged.
- Added OpenAI-compatible `/v1/images/generations` and `/v1/images/edits`, persistent generated artifacts, scoped file access, and direct URL/Base64 responses.
- Added bounded, session-aware response state and stable account affinity for explicit client session IDs and `previous_response_id` chains.
- Persisted the OAuth desktop client metadata with newly authorized `add` accounts so their refresh tokens remain usable after moving the account pool to a host without a local agy installation.

## 0.8.3 - 2026-09-24

- Refined the Token dashboard into a responsive chroma-bento layout with smooth model trends, period-aware hourly heatmaps, model consumption share, larger tutorial QR presentation, and resilient account-pool sizing.
- Added fully local account-masked PNG generation: desktop browsers download the result directly, while mobile browsers receive a long-press save preview without invoking system sharing or a server-side screenshot process.
- Preserved the live page's responsive geometry during export, embedded local image assets, retained a compatibility renderer, and fixed html2canvas foreign-object coordinate drift that cropped the left and top edges.

## 0.8.2 - 2026-09-21

- Switched dashboard quota snapshots to Antigravity's official `/usage` summary, showing the shared weekly and five-hour limits for the Gemini and Claude/GPT model groups per account.
- Kept model-catalog quota observations for routing compatibility while model usage charts continue to reflect the exact model IDs actually called.

## 0.8.1 - 2026-09-21

- Made the managed account pool the dashboard's only account source, so historical or unbound usage identifiers can no longer appear as accounts or affect account/model aggregates.
- Replaced the single highest-model quota display with per-account details for every model actually called, including exact usage, model-specific remaining quota, reset time, and stale-snapshot state.
- Kept the most recent expired quota snapshot visible as an explicitly marked previous snapshot while routing continues to use only fresh quota observations.

## 0.8.0 - 2026-09-20

- Added a lightweight dark Token dashboard at `/dashboard`, opened with `antigravity-gateway stats` while either foreground or background mode is active and served by the existing gateway process without another web service.
- Added 1/3/7/30-day and account filters with lifetime KPIs, account quota cards, hourly heatmaps, model trends, and daily Token composition.
- Extended the persistent aggregate model with hourly account, model, and account-model dimensions while remaining backward compatible with existing usage files and continuing to store no prompts or responses.
- Added dashboard endpoint, data-shape, persistence-dimension, self-contained asset, and regression coverage.

## 0.7.0 - 2026-09-19

- Added persistent multi-account OAuth login from the running foreground gateway: type `add` at `gateway>`, with both automatic browser opening and the complete copyable authorization URL.
- Complete first-login authorization through the official Antigravity OAuth client, `loadCodeAssist` tier discovery, asynchronous `onboardUser` project initialization, and post-onboarding project re-discovery before persisting an account; pasted localhost callback URLs are accepted while authorization is active and receive a clear stale-flow message afterward.
- Added plain per-account JSON persistence under `~/.antigravity-gateway/accounts/`. Managed access/refresh tokens survive gateway restarts and refreshed values are written back atomically; no encryption, ACL, or custom file-permission layer is imposed.
- Added sticky client-session routing, smooth weighted account rotation, one-attempt-per-account failover, model-specific quota cooldowns, authentication cooldowns, and request-error classification while preserving every client model ID unchanged.
- Added asynchronous per-account, per-model quota snapshots from the real model catalog and low-overhead exact usage accounting from upstream metadata, separating client requests from upstream attempts and tracking input, output, thinking, cached, and total tokens.
- Persist usage only when dirty every five minutes, refresh the 24-hour histogram hourly, and refresh the historical dashboard total every 24 hours.
- Added the foreground terminal console with `add`, `acc`, `models`, `status`, `usage`, `reload`, `config`, `logs`, `clear`, `version`, `help`, and `quit` commands. Background service behavior and existing client endpoints remain unchanged.
- The gateway now imports a newly detected official local agy account into the managed pool on startup without overwriting an existing matching account, and request routing logs identify the account actually selected for each upstream attempt.
- Added regression tests for account persistence, sticky rotation, quota failover, request-error handling, usage persistence, hourly buckets, OAuth callback parsing, and terminal charts.

## 0.6.2 - 2026-09-18

- Fixed Claude Code 2.1.276 requests being rejected by Cloud Code as `429 RESOURCE_EXHAUSTED` because Claude Code copied an `x-anthropic-billing-header` transport marker into the model-visible system text.
- Strip only that Anthropic-specific billing pseudo-header before native Cloud Code forwarding; the complete conversation, tool schemas, system instructions, output budget, and Gemini context window remain unchanged.
- Added regression coverage that preserves adjacent system instructions while removing the rejected transport metadata.

## 0.6.1 - 2026-09-07

- Reject invalid Host headers safely and deny unapproved browser origins while preserving origin-free CLI access.
- Enforce request deadlines and bound uploads before body parsing; reject ambiguous Auto Mode XML instead of choosing an allow verdict.
- Validate nested JSON Schema combinators and tuples; preserve model IDs, full input, and client-side tool execution.
- Refresh model catalogs with concurrent probe deduplication and stale-catalog fallback; coalesce local OAuth refreshes and honor custom agy paths.
- Rotate background logs during execution, bound log-tail reads, restart existing Linux services after configuration updates, and use USERPROFILE on Windows when HOME is absent.
- Refuse to persist explicit OAuth token/client-secret environment variables in background snapshots; foreground usage and local agy login remain unchanged.

## 0.6.0 - 2026-09-04

- Replaced the top-level-only tool-schema cleanup with a recursive compatibility normalizer for `properties`, `items`, `prefixItems`, `anyOf`, `oneOf`, and `allOf`, fixing Claude Code 2.1.259/2.1.260 `Artifact` tool requests rejected by Cloud Code for missing nested array `items`.
- Removed the local model catalog as a request gate. Normal client requests now preserve the exact model ID and always reach Antigravity upstream, even when discovery does not list that model.
- Preserve upstream failures and append a non-blocking gateway diagnosis only when the requested model is absent from the currently discovered catalog. Auto Mode retains its separate fast-model route.
- Raised the default direct model-catalog discovery timeout from three to eight seconds after real macOS requests were observed completing in about five seconds; the environment override remains available.

## 0.5.0 - 2026-09-03

- Added `antigravity-gateway service start` as the cross-platform background keepalive entry point while preserving the existing foreground `antigravity-gateway` command.
- Added service lifecycle commands for status, restart, stop, logs, and uninstall. Re-running `service start` refreshes the saved gateway environment and restarts the existing service without creating duplicates.
- Added native per-user integration with macOS LaunchAgents, Linux systemd user services with linger enablement, and Windows Task Scheduler using S4U plus startup/login triggers.
- Added a platform-independent supervisor that restarts a failed gateway process after three seconds, with operating-system supervision retained for supervisor failures.
- Added private environment snapshots, 10 MiB rotating service logs, install-time foreground/background command guidance, and automated service-definition coverage.
- Verified foreground compatibility and the complete background lifecycle on macOS ARM64, Debian Linux, and Windows 11 x64, including real direct requests and forced child-process recovery.

## 0.4.0 - 2026-09-03

- Added one deterministic, presentation-only model order for the startup banner, `--models`, `/v1/models`, and generated Claude Code/Codex catalogs. Models not named in the preferred list remain visible after it, while request routing and the client-selected model ID remain unchanged.
- Added native Linux local-session discovery through the official `~/.gemini/antigravity-cli/antigravity-oauth-token` file and Secret Service, while preserving macOS Keychain and Windows Credential Manager behavior.
- Preserved `DBUS_SESSION_BUS_ADDRESS` in the isolated Linux agy child environment so Secret Service remains reachable without exposing unrelated credentials.
- Placed `gemini-3.8-flash-high` first in model presentation and grouped the remaining Gemini 3.8 Flash variants after `gemini-3.1-flash-image`; made 3.8 High the missing-model-field default and preferred 3.8 Low for Auto Mode classifiers.
- Recorded the verified Gemini 3.8 Flash 1,048,576-token input and 65,536-token output metadata as the catalog fallback.

## 0.3.1 - 2026-09-02

- Corrected the startup BaseURL label from `Antigravity` to `Anthropic`, matching the protocol served at the root URL. The OpenAI-compatible endpoint remains `/v1`.

## 0.3.0 - 2026-09-01

- Preserve the exact model ID supplied by Anthropic, Responses, and Chat Completions clients. The default model is now used only when a request omits `model`.
- Removed automatic Claude/GPT/Haiku alias rewriting. Unknown models are sent upstream unchanged; `ANTIGRAVITY_MODEL_ALIASES` remains available only for user-defined exact mappings.
- Restrict the auxiliary fast-model route to detected Claude Code Auto Mode classifier requests, without changing the model used by the main conversation.
- Added a concise startup banner with protocol-specific BaseURLs, API-key guidance, the active local credential source, and selected Gemini 3.7/Claude model IDs.
- Added `--models`, `--claude-config`, and `--claude-config-path`. The generated Claude Code `modelPicker` settings expose every model discovered for the current account without inventing aliases.
- Kept the Windows/macOS local credential acquisition implementation unchanged.

## 0.2.1 - 2026-09-01

- Added Windows Credential Manager authentication lookup for `LegacyGeneric:target=gemini:antigravity`, with the existing local session files retained as fallbacks.
- Preserved macOS Keychain-first authentication and added platform-injected coverage so the Windows credential reader can be tested without affecting macOS.
- Verified the release on macOS and Windows 11 with agy 1.1.22, including token refresh, model discovery, and a real direct request.

## 0.2.0 - 2026-08-31

- Added first-class Windows support for the official `%USERPROFILE%\.gemini\antigravity-cli\antigravity-oauth-token` session and `%LOCALAPPDATA%\agy\bin\agy.exe`, without changing the existing macOS Keychain-first path.
- Preserved the Windows profile, system, temporary-directory, and executable lookup variables required by agy child processes while continuing to exclude unrelated credentials.
- Replaced whole-binary OAuth metadata reads with bounded incremental scanning so the Windows native agy executable can be inspected without allocating hundreds of megabytes as a string.
- Detect the real agy version in direct mode on both Windows and macOS and handle Claude Code's `GET`/`POST`/`HEAD /api/hello` connectivity probes.
- Acknowledge Claude Code's `/api/event_logging/batch` locally with HTTP 204 instead of forwarding telemetry or logging a false missing-interface error.
- Added current Claude Code 2.1.251 Auto Mode block/severity contract detection and raised only the upstream classifier reasoning budget so complete XML verdicts are returned without retry storms.
- Raised the Gemini 3 provider-side minimum for tiny output caps after real macOS testing proved that hidden reasoning could truncate a six-token answer; normal client context remains untouched.
- Added native OpenAI Responses `custom_tool_call` and `custom_tool_call_output` round trips, including Codex `apply_patch` grammar projection, instead of degrading free-form tools into incompatible function calls.
- Use Cloud Code's discovered `maxTokens` and `maxOutputTokens`; Gemini 3.7 Flash now advertises its verified 1,048,576-token input window and 65,536-token output limit rather than the old 200K fallback.
- Reclassified gateway body/prompt guards as byte limits, raised both defaults to 64 MiB, and removed misleading context-window wording. The gateway still leaves authoritative token accounting to Cloud Code.
- Generate a per-user Codex model catalog at startup and expose its path through the banner, health response, and `--codex-catalog-path`, preventing Codex fallback metadata warnings.
- Verified on Windows 11 x64 with agy 1.1.22, Claude Code 2.1.251, and Codex CLI 0.151.0: direct login reuse, 1M client configuration, PowerShell tools, Auto Mode, Explore subagents, Responses tools, and `apply_patch`. Regressed real Anthropic/Responses and Claude Code/Codex file tools on macOS ARM64.

## 0.1.2 - 2026-08-30

- Fixed Claude Code 2.1.251 requests being rejected by Cloud Code as `429 RESOURCE_EXHAUSTED` because of the newly injected standalone `You are a Claude agent, built on Anthropic's Claude Agent SDK.` provider marker. The gateway now replaces only that transport-specific identity line with a neutral compatibility identity and preserves the rest of the system prompt unchanged.
- Fixed Claude Code 2.1.251 built-in helper agents and Auto mode probes competing with the main session for the same high-capacity model route. Haiku aliases and detected Auto mode classifiers now select an available low-latency model by default.
- Added `ANTIGRAVITY_FAST_MODEL` for an explicit helper/classifier model override; exact entries in `ANTIGRAVITY_MODEL_ALIASES` still take precedence.
- Fixed direct transport stopping immediately on a `429 RESOURCE_EXHAUSTED` response from `daily-cloudcode`; retryable 429/5xx responses now try the normal Cloud Code endpoint and use one bounded exponential-backoff retry.
- Added `fast_model` to health/model discovery responses and show both default and auxiliary routes in the startup banner.
- Treat Claude Code cancellation of superseded classifier/tool requests as normal control flow instead of reporting a misleading gateway internal error.
- Added regression coverage for Haiku routing, Auto mode routing, daily-to-normal 429 fallback, and bounded retry recovery.

## 0.1.1 - 2026-08-23

- Added the gateway version to the startup banner, health response, `--help`, and `--version`, all sourced from `package.json`.
- Fixed direct-mode authentication on macOS by reading the official `gemini / antigravity` Keychain record before stale local session files.
- Fixed OAuth client-secret discovery so adjacent Mach-O bytes are not included in the secret; expired access tokens can now be refreshed directly without handing model requests to agy.
- Made native Cloud Code `direct` transport the default; missing credentials now fail explicitly instead of silently switching to the agy Agent transport.
- Added native Cloud Code transport that reuses the local Keychain/session state in memory, so requests can skip the `agy` Agent wrapper prompt without a second OAuth setup.
- Kept explicit auth JSON/access-token/refresh-token/project configuration as a documented manual fallback; refreshed local tokens are never written back by the gateway.
- Added local agy auth discovery, in-memory refresh, native request envelopes, Antigravity User-Agent/tool mode, function-call projection, and upstream text-delta forwarding.
- Added direct `fetchAvailableModels` discovery with daily-to-production fallback and a bounded timeout; explicit `ANTIGRAVITY_DIRECT_MODELS` still overrides discovery.
- Added a small minimum output budget for high/thinking models so low client caps do not consume the entire turn on hidden reasoning and return an empty visible message.
- Added live text SSE forwarding for plain Anthropic and Chat Completions requests; constrained tool, Auto mode, and structured-output requests remain buffered for validation.
- Added direct-provider unit coverage and documented the new transport and credential boundaries in both README languages.
- Normalized nullable/union tool schema types to the scalar schema format accepted by Cloud Code.
- Fixed native tool-history requests by removing Claude-only tool IDs from Gemini function-call parts.
- Preserved Cloud Code `thoughtSignature` values across Claude tool turns so follow-up requests can use prior native function calls.
- Added Gemini 3 thought-signature replay compatibility for stale Claude histories: real signatures are preserved, while a missing signature uses the first-call `skip_thought_signature_validator` sentinel and is not duplicated across parallel calls.
- Replaced the direct transport's XML tool-call envelope with typed `functionCall`/`functionResponse` mapping, including tool IDs, tool-name correlation, streamed argument assembly, and native tool-call validation.
- Upstream HTTP 400 diagnostics now include the sanitized provider reason instead of only a generic gateway error.
- Removed maintainer-specific absolute paths and resolve `agy` from the current user's `PATH` by default.
- Moved transient workspaces and logs from the source tree to a per-user operating-system temporary directory, with an environment-variable override.
- Reworked the bilingual README for arbitrary installation directories, account-specific model discovery, and macOS/Linux/Windows environment configuration.
- Added a global CLI installation flow so users can install in one command and run `antigravity-gateway` from any directory.
- Added an npm lifecycle environment check for Node.js, supported operating systems/architectures, and writable temporary storage.
- Added fallback discovery for the official per-user `agy` install locations when the current shell has not reloaded its updated `PATH`.
- Documented Node.js/npm bootstrap commands for macOS, Linux, and Windows.
- Switched the GitHub install command to the branch tarball URL for reliable npm lifecycle execution without requiring a Git checkout.

## 0.1.0 - 2026-08-22

- Added official `agy` headless subprocess adapter with Keyring-session reuse.
- Added Anthropic Messages, OpenAI Responses, and Chat Completions endpoints.
- Added OpenAI and Codex-compatible model catalogs.
- Added experimental client tool projection and result round trips.
- Added Claude Code Auto mode XML and JSON Schema normalization.
- Added process isolation, environment filtering, concurrency limits, cancellation, SSE heartbeats, and log cleanup.
- Verified real Gemini responses, Claude Code text/tool loops, and Codex CLI basic Responses usage.
