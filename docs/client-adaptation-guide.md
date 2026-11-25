# 第三方客户端适配指南（Fork 与扩展说明）

这份指南面向使用 `pi`、`openclaw`、`opencode` 或其他自研 Agent / CLI 客户端的开发者。如果你的客户端通过 `antigravity-gateway` 调用模型时出现 400/429、工具调用失败、多轮签名丢失或系统指令失效，可以按本文流程 Fork 仓库并完成最小侵入式适配。

---

## 先判断：要不要改代码

网关对标准 OpenAI Chat（`/v1/chat/completions`）、OpenAI Responses（`/v1/responses`）和 Anthropic Messages（`/v1/messages`）客户端默认走通用兼容路径：所有未单独注册的工具都会自动包装为 `mcp_gateway_tool_<slug>_<hash16>[_json]`，并严格按客户端原始 JSON Schema 校验参数。

先按报错或现象对照下表，再决定动哪一层：

| 现象 | 常见原因 | 对应改动入口 |
| --- | --- | --- |
| 请求被网关直接返回 `400`：`unsupported_input_item`、`unsupported_content_block`、`unsupported_tool_grammar` | 客户端发了网关尚未认识的协议块类型，或带了新的 `custom` 工具语法（`format.type === 'grammar'`） | `src/protocol.js`、`src/antigravity-tool-contract.js`（`customValidator`） |
| 上游反复拒绝（`400` / 异常 `429`），或模型无视客户端的 System Prompt / 权限约束 | 客户端的系统提示词夹带强厂商身份声明，或单槽 `systemInstruction` 与网关工具契约混排导致上游冲突 | `src/client-identity.js`、`src/client-instruction-profile.js`、`src/client-instruction-envelope.js`（可先试 `ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE=gemini4` 或 `all`，并用 `antigravity-gateway --diagnose-request <file>` 离线检查） |
| 多轮对话频繁掉 `thoughtSignature`、同会话被拆到不同账号，或标题/压缩请求冲乱主会话 | 客户端使用自定义 Session / Thread 请求头，或把无工具辅助请求与主会话混在同一个 Session ID 下 | `src/session-manager.js`（`explicitClientId`、`explicitSessionId`、`auxiliaryScope`） |
| 常规工具能调通，但希望把文件读/写/编辑工具额外映射为官方 `read_file` / `write_file` / `edit_file` 子集视图 | 客户端文件工具未注册到已验证工具指纹表 | `src/antigravity-tool-contract.js`（`VERSIONS`、`PROFILES`） |
| 请求返回 `502 empty_upstream_response` 或小 `max_tokens` 输出截断 | 上游静默返回 0-token 空流，或思考模型配额过小 | 先看请求日志 `conversion` 脱敏字段定位模型与参数，再决定是否调整客户端配置 |

如果只是普通工具（Shell、搜索、HTTP、MCP 工具等）偶发参数格式问题，先确认客户端发出的工具 JSON Schema 是否合法；大多数客户端不需要写专属工具映射代码。

---

## 第一步：Fork 仓库并做脱敏抓包

不要凭猜测改提示词或工具规则。先抓到客户端发给网关的真实请求结构。

### 1. Fork 并创建分支

```bash
git clone https://github.com/<your-name>/antigravity-gateway.git
cd antigravity-gateway
git remote add upstream https://github.com/baileyh8/antigravity-gateway.git
git checkout -b feat/adapt-<client-name>
npm ci --ignore-scripts --no-audit --no-fund
```

### 2. 用本地临时抓包脚本采集最小合成样本

在空临时目录下用全新合成任务跑客户端，只采集三种请求：

1. **首轮纯文本请求**：拿到完整 HTTP 请求头、`system` / `instructions` / `developer` 消息结构。
2. **工具调用 + 回执往返**：拿到完整 `tools` 声明数组、客户端回传的 `tool_call` / `tool_result` 格式。
3. **辅助请求（如有）**：标题生成、分支命名、上下文压缩或子代理请求，确认它们带了什么 Header 以及是否声明了工具。

可以用下面这段最小 Node 脚本把请求头和请求体落到本地临时目录，再转发给本机网关：

```bash
node -e '
const http = require("node:http"), fs = require("node:fs");
const TARGET = "http://127.0.0.1:9897";
const OUT = "/tmp/client-capture";
fs.mkdirSync(OUT, { recursive: true });
let seq = 0;
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const id = String(++seq).padStart(3, "0");
    const headers = { ...req.headers };
    delete headers.authorization;
    delete headers["x-api-key"];
    fs.writeFileSync(`${OUT}/${id}.json`, JSON.stringify({
      method: req.method, url: req.url, headers,
      body: (() => { try { return JSON.parse(body.toString("utf8")); } catch { return body.toString("utf8"); } })()
    }, null, 2));
    const upstream = await fetch(TARGET + req.url, {
      method: req.method, headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body
    });
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  });
}).listen(19897, "127.0.0.1", () => console.log("Capture proxy on http://127.0.0.1:19897"));
'
```

抓包样本只用合成提示词和假文件路径，不要把真实项目代码、私钥、账号邮箱或个人记忆留进仓库的测试 fixture。

---

## 第二步：按层级实施适配

下面四层彼此独立，按需修改对应层即可，不要把无关层混在一起。

### 层级 A：会话标识与辅助请求隔离（`src/session-manager.js`）

客户端多轮对话无法保持在同一会话，或者标题、压缩请求干扰主会话状态，先检查抓包里的请求头与顶层字段：

1. **客户端标识**：如果客户端带有固定标识头（类似 `x-deepseek-harness-user-id`），补入 `explicitClientId()`。
2. **会话与线程标识**：如果客户端使用了网关尚未列出的会话头或线程头，补入 `explicitSessionId()`。注意区分根会话 ID（`session`）与子线程 ID（`own`），子线程应保持独立的原生上下文状态，不要覆盖父线程历史。
3. **辅助作用域隔离**：如果客户端在同一个 Session ID 下同时发“带工具的主会话请求”和“无工具的标题/摘要/压缩请求”，参考 `auxiliaryScope()` 的写法，只根据**显式请求头**或**工具声明面**（例如 `normalized.tools.length === 0` 且末尾无 `tool_result`）分区，不要用自然语言关键词（如正文里出现“总结”“标题”）去猜。

### 层级 B：协议块与 Custom Tool Grammar（`src/protocol.js`、`src/antigravity-tool-contract.js`）

1. **新协议输入项或内容块**（`src/protocol.js`）：
   - `CONTENT_BLOCK_TYPES` 控制消息内内容块白名单，`RESPONSE_INPUT_TYPES` 控制 Responses 顶层 `input` 项白名单。
   - 只有在能无损映射到网关内部 `parts`（文本、媒体、`tool_call`、`tool_result`）时才加入白名单。
   - 遇到无法在本地解密或还原的不透明块（例如 Responses 的 `compaction.encrypted_content`），必须返回清晰的 `400 GatewayError`，不要静默丢弃。
2. **自定义 Grammar 工具**（`src/antigravity-tool-contract.js`）：
   - Responses 的 `type: 'custom'` 且带 `format.type === 'grammar'` 的工具默认会被 `customValidator()` 拒绝（`400 unsupported_tool_grammar`），防止上游模型输出破坏语法约束的字符串。
   - 如果你的客户端带有固定语法工具（类似 Codex 的 `apply_patch` 或 `exec`），先锁定精确的 `format.syntax` 与 `format.definition` 原文，再在 `customValidator()` 中添加对应的本地校验函数。

### 层级 C：指令信封与身份清洗（最常见）

网关的设计原则是**基于内容指纹与协议来源，而非 `User-Agent`**。原因有两个：代理层常常改写 UA；只看 UA 容易误伤其他客户端或被普通文本伪造。

#### 1. 先排查是不是指令槽位冲突

Gemini 上游只有一个 `systemInstruction` 槽位。网关本身需要在这里放置工具契约索引；某些客户端把长达数万字符的框架说明、环境信息与权限规则直接塞进 `system`，混排后容易让模型忽略客户端指令或触发上游拒绝。

网关提供了指令分离封装机制（`src/client-instruction-envelope.js`）：把网关工具契约与优先级声明留在 `systemInstruction`，把客户端原始系统指令放进首条独立消息 `<CLIENT_SYSTEM_INSTRUCTIONS>...</CLIENT_SYSTEM_INSTRUCTIONS>`，且位于原生会话时间线之外，动态更新系统提示词时不会打断多轮签名链。

#### 2. 为新客户端注册指令指纹

打开 `src/data/client-instruction-profiles-20261121.json`（或新建你自己的数据文件并在 `src/client-instruction-profile.js` 中加载），填入三类证据：

- `anchor` + `frameworkLength` + `frameworkSha256`（或 `prefixLength` + `prefixSha256`）：客户端固定框架段落的精确长度与 SHA-256，避开工作目录、日期、用户规则等动态内容。
- `tools`：1–2 个该客户端标志性工具的 `name` 与规范化 Schema 的 SHA-256。

用下面的一行脚本直接从抓包 JSON 算出规范化 Schema 哈希与固定段落哈希：

```bash
node -e '
const crypto = require("node:crypto");
const fs = require("node:fs");
const stable = v => Array.isArray(v) ? v.map(stable)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const sha = s => crypto.createHash("sha256").update(s).digest("hex");

const cap = JSON.parse(fs.readFileSync("/tmp/client-capture/001.json", "utf8"));
// 1) 打印每个工具的 schema sha256（按 Chat/Responses/Anthropic 实际字段调整 schema 路径）
for (const t of cap.body.tools || []) {
  const name = t.name || t.function?.name;
  const schema = t.input_schema || t.parameters || t.function?.parameters || { type: "object" };
  console.log("TOOL", name, sha(JSON.stringify(stable(schema))));
}
// 2) 对固定框架片段计算长度与 sha256（把 FIXED_BLOCK 换成实际抓到的静态片段）
// console.log("FRAMEWORK", FIXED_BLOCK.length, sha(FIXED_BLOCK));
'
```

注册完指纹后，在 `src/client-instruction-envelope.js` 的 `evidence` 表里加上该客户端的 `evidence` 名称：

```js
const evidence = {
  claude: ['claude-desktop-330-system-template', 'claude-desktop-title-system-template'],
  hermes: ['hermes-instructions-20261121'],
  openclaw: ['openclaw-instructions-20261123'] // 示例
}[profile?.client];
```

如果只需要在脱敏日志 `conversion.identityProfile` 中看到新客户端名，顺手把它加进 `src/request-log.js` 的 `KNOWN_IDENTITY_CLIENTS` 白名单。

#### 3. 仅在必要时做固定身份句清洗（`src/client-identity.js`）

如果客户端在框架开头硬编码了“你是某某闭源模型/产品”导致上游模型拒绝扮演或输出错乱，才在 `src/client-identity.js` 增加规则：

- 在 `detectTemplate()` 中用固定前缀和多个结构锚点共同确认模板，不能只匹配一个词。
- 用 `quotedAt()` 或精确偏移边界确保不改动代码块、引用标签或用户自定义的 `CLAUDE.md` / `AGENTS.md` / `SOUL.md` 规则。
- 在 `cleanInstruction()` 中只删改那一句固定身份声明，完整保留权限、安全和工具使用约束。

### 层级 D：官方文件工具子集视图（`src/antigravity-tool-contract.js`，可选）

大多数客户端不需要这一层。只有在满足以下全部条件时才考虑添加：

1. 客户端拥有独立的文本读（`read`）、整文件覆写（`write`）或全量精确替换（`edit`）工具；
2. 参数能够与官方 `read_file` / `write_file` / `edit_file` 实现**严格无损双向转换**（`toNative` / `fromNative`）；
3. 仍然保留 `mcp-direct` / `mcp-json` 兼容视图，承接图片、PDF 以及唯一替换、沙箱权限等超出子集范围的调用。

接入步骤：

1. 用现成函数计算工具完整声明指纹（包含 `name`、`description`、`schema`、`kind`）：

```bash
node -e '
const { fingerprint } = require("./src/antigravity-tool-contract");
const { normalizeChat } = require("./src/protocol"); // 按协议换 normalizeAnthropic / normalizeResponses
const cap = require("/tmp/client-capture/001.json");
const normalized = normalizeChat(cap.body);
for (const tool of normalized.tools) {
  console.log(tool.name, fingerprint(tool));
}
'
```

2. 在 `src/antigravity-tool-contract.js` 的 `VERSIONS` 与 `PROFILES` 中登记客户端版本、字段名（`file_path` 或 `path`）与指纹哈希。
3. 确认 `recognizedRule()` 的 `profile.client` 与 `profile.templateVersion` 与 `src/client-identity.js` 返回值一致。

---

## 第三步：编写测试与隔离验收

新增适配必须配独立的单元测试文件（例如 `tests/client-<name>-adaptation.test.js`），至少覆盖四类断言：

1. **正向匹配与往返**：使用脱敏合成抓包数据，验证 `sanitizeClientIdentity`、`capturedInstructionProfile`、`prepareAntigravityTools`、`buildDirectRequest` 与工具 `toProvider` / `toClient` 往返无损。
2. **变异拒绝**：改动框架固定句中的任意一处、篡改一个工具 Schema 字段，或把框架重复拼两次，断言匹配返回 `null` / `false`，不会误套规则。
3. **不可变性**：断言调用前后的 `normalized` 对象深相等，没有被原地修改。
4. **全量回归与零主线程 Ajv**：运行完整套件，确认不破坏已有测试和 Worker 隔离边界。

使用隔离配置目录跑完整验证：

```bash
npm run check
gateway_test_config="$(mktemp -d)"
ANTIGRAVITY_GATEWAY_CONFIG_DIR="$gateway_test_config" npm test
status=$?
rm -rf "$gateway_test_config"
test "$status" -eq 0
npm pack --dry-run
```

全绿后，再用本地网关对接真实客户端跑一轮真机验证：
- 首轮纯文本对话 + 流式输出；
- 带工具调用与 `tool_result` 多轮往返；
- 修改动态系统提示（或记忆变化）后的第 2 轮工具续接，检查请求日志 `conversion` 中的 `identityProfile`、`envelopeApplied`、`wire.signedCalls` 是否符合预期。

---

## 第四步：维护自用 Fork 或提交 PR

### 长期维护自用 Fork 的减冲突技巧

- 把新客户端的静态框架摘要与工具指纹放在独立 JSON 文件（`src/data/<client>-<version>.json`），把测试放在独立 `tests/<client>-*.test.js`。
- 尽量只通过数据注册表挂载到 `client-instruction-profile.js`、`client-identity.js`、`antigravity-tool-contract.js`，减少改写 `direct-provider.js` 和 `account-pool.js`。
- 定期同步维护仓库更新：

```bash
git fetch upstream main
git rebase upstream/main
```

### 给主仓库提 PR 的检查清单

如果希望把适配回馈给 `baileyh8/antigravity-gateway`（PR 目标分支为 `main`，不要误提给原上游 `LeeFeee/antigravity-gateway`），请在 PR 描述里附带：

- 目标客户端名称、准确版本号与所用 API 协议（Chat / Responses / Anthropic）。
- 脱敏后的合成测试 fixture（不含私有路径、真实代码、账号或密钥）。
- 适配前后对比现象（例如修复前报错码或上游拒绝表现，修复后工具往返结果）。
- 本地全量 `npm test` 与隔离真机验证结果，以及尚未覆盖的边界（例如某些特殊模型或未测场景）。

---

## 五条适配红线

改动时请遵守以下边界，否则极易引入隐蔽故障或安全漏洞：

1. **不按 `User-Agent` 放权或猜客户端**：UA 只能作为日志辅助，身份和指令适配必须有协议来源或内容摘要证据。
2. **不删改客户端的安全与权限提示**：清洗仅限固定厂商身份句，禁止删除用户规则、审批要求和沙箱限制。
3. **不伪造签名、时间戳或工具回执**：缺失或跨模型不兼容的签名交由既有 `ensureToolSignatures` 策略处理，不自行拼接假数据。
4. **不绕过 JSON Schema 校验**：所有工具参数与结构化输出必须在 Worker 异步边界内严格校验，HTTP 路径禁止引入主线程同步 Ajv。
5. **不提交私密信息**：测试样例和 PR 中禁止出现真实 Token、账号邮箱、代理地址、订阅链接或个人私有提示词。
