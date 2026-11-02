# agy-manager · 独立管理后台

**特别感谢 [LeeFeee/antigravity-gateway](https://github.com/LeeFeee/antigravity-gateway) 的作者与贡献者。** 本项目是基于原项目继续维护的分支方向；上游的网关与协议实现是基础，本分支围绕代理基座和独立管理后台的解耦继续发展。保留原作者版权、项目历史与根目录 [MIT 许可](../LICENSE)。

本目录随 Gateway `1.7.1-bailey.3` 提供，管理应用版本为 `0.1.0`。后台不会单独运行代理逻辑。

## 架构与功能

```text
浏览器 /admin/ ──> 静态页面 + Node 管理 API（127.0.0.1:9898）
                                   │ 管理令牌，/_admin/v1
                                   ▼
客户端 /v1/* ─────────────────> 代理基座（127.0.0.1:9897）──> 上游
```

| 层 | 职责 |
| --- | --- |
| 代理基座 | 推理、流式输出、账号凭据、调用密钥、代理出口、调度、额度、模型配置与请求日志 |
| 管理 API | 登录、会话、CSRF/Origin 校验、操作审计、备注、转发与短时缓存 |
| 静态前端 | 看板、账号/代理/额度、用量、日志、模型、密钥与设置 |

额度展示包含 Gemini、Claude / GPT 和 Argon；5h 与周额度在同组上下排列。图表使用细柱、平滑曲线和悬停/点击明细；数量以 K/M/B 保留两位小数。账号在日志与用量中统一为脱敏邮箱。

前端运行时无需 Next.js 服务，管理进程与基座独立。请求日志由基座异步写入，保留 30 天、总量上限 500MB；查询通过 worker 分块扫描，最多 20,000 行。内存实际占用随账号数、请求和原生 helper 数量变化，不承诺固定值。

## 安装与本地运行

要求 Node.js 24 LTS 和 npm。先从本仓库配置并启动基座；管理接口要求此维护版本提供的 `/_admin/v1`，旧版网关不兼容。根目录的 npm 安装包只分发基座，后台需克隆仓库后单独构建。

```bash
git clone https://github.com/baileyh8/antigravity-gateway.git
cd antigravity-gateway
npm ci
npm ci --prefix manager/server
npm ci --prefix manager/web
npm run manager:check
npm run manager:test
npm run manager:build
```

在基座与管理 API 中配置相同的管理令牌文件；该文件只对两个服务账户可读。可以用 `openssl rand -hex 32` 生成，文件权限设为 `0600`。它不是客户端调用 `/v1` 的 API key。已有环境应复用当前令牌，避免使另一个进程失联。

```bash
# 基座：将以下两项加入现有服务环境，再按原方式启动基座。
export AGY_ADMIN_TOKEN_FILE=/absolute/private/admin-token
export ANTIGRAVITY_GATEWAY_PORT=9897
```

管理服务的环境变量示例位于 [server/.env.example](server/.env.example)。Node 不会自动加载该文件，请通过服务管理器或 `node --env-file` 加载。

```bash
# 仓库根目录；先复制 .env.example，再填写本地绝对路径。
cp manager/server/.env.example manager/server/.env
node --env-file=manager/server/.env manager/server/src/index.js
```

打开 `http://127.0.0.1:9898/admin/`。示例用户名为 `admin`；未指定初始密码时，首次启动会把随机密码写入 `AGY_MANAGER_DATA_DIR/initial-admin-password`，不会打印到日志。登录后在“设置”改密，该文件会被删除，其他旧会话会失效。不要将数据目录或密码文件提交到 Git。

## 生产部署

- 两个服务各用独立进程与启动单元，均监听回环地址。基座启用客户端调用密钥，管理服务使用独立管理令牌。
- `NODE_ENV=production`，明确设置 `AGY_MANAGER_ORIGIN=https://gateway.example.com`、`AGY_MANAGER_COOKIE_SECURE=1` 和持久的 `AGY_SESSION_SECRET_FILE`。会话密钥至少 32 字符，与管理令牌分开生成。
- 设置 `AGY_MANAGER_SERVE_STATIC=1`，静态目录默认指向同目录树中的 `manager/web/out`；也可用 `AGY_MANAGER_STATIC_DIR` 显式指定。
- HTTPS 反向代理示例见下方。公网必须屏蔽 `/_admin`，管理 API 由管理服务在回环访问。业务 `/v1` 路由继续使用原有配置。
- 更新后台时构建静态资源，重启管理服务；若更新包含管理契约变更，先确认基座与后台版本匹配。备份只包含配置和必要回滚材料，勿将凭据复制到公开目录。

```nginx
location = /_admin { return 404; }
location ^~ /_admin/ { return 404; }
location = /admin { return 301 /admin/; }
location ^~ /admin/ {
    proxy_pass http://127.0.0.1:9898;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location = /dashboard { return 301 /admin/dashboard/; }
location = /dashboard/ { return 301 /admin/dashboard/; }
location ^~ /dashboard/ { return 404; }
```

旧面板已经从基座剥离。以上 301 仅兼容页面入口，旧管理 API 不再恢复。

## 预览与验证边界

[README 截图](../README.md#新后台预览--admin-preview)来自本版本实际静态构建，账号、IP、密钥前缀与用量均为虚构演示数据。

维护环境已验证管理读写、图表交互、日志、目录与最小文本请求。真实 OAuth 授权全过程、生产账号删除/启停和高并发压测不属于本次完整验收；不以页面截图或健康检查代替这些验证。

## English

With sincere thanks to LeeFeee and all upstream contributors. This is a maintained fork direction based on the original gateway. Original copyright, history and MIT licensing are preserved.

The proxy core owns inference, credentials, keys, proxies, scheduling and request logs. This directory contains a separate Node management API and a static Next.js frontend at `/admin/`. Install the two dependency sets independently, build `manager/web`, and start `manager/server` with a private shared admin-token file. Use Node 24, TLS, a persistent session secret and an explicit production origin. Keep the core admin API loopback-only and block `/_admin` at the public reverse proxy. The npm core package intentionally excludes the manager and its frontend dependencies. All published screenshots contain synthetic demo data.
