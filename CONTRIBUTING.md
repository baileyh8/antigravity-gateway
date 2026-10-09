# 贡献与维护 / Contributing

本仓库 `baileyh8/antigravity-gateway` 是 Bailey 独立维护的 Gateway 发行线。`main` 是默认安装和维护分支；当前稳定性开发位于 `codex/bailey-stability`。原项目 `LeeFeee/antigravity-gateway` 保留来源归属和 MIT 许可，更新应经过差异审查与兼容验证后再纳入，不直接覆盖维护补丁。

## 提交变更

- 从本仓库最新维护代码创建 `codex/<topic>` 分支，PR 目标为本仓库 `main`。不要自动向原项目创建 PR。
- 说明问题、行为变化、验证结果和已知限制。接口、环境变量、安装/升级、默认值变化同时更新中英文 README；用户可见变更进入 CHANGELOG。
- 发布代码版本时同步 `package.json` 与 `package-lock.json` 的版本；纯文档更正不必升级运行版本。版本标签与 Release 只能指向已经通过验证的提交，不能将仅完成的本地测试写成真实部署验收。
- 保留原作者版权、许可证和历史归属。不要提交账号、Token、订阅 URL、私有部署地址、个人运维台账或真实用量明细。样例使用占位域名和虚构凭据。

## 验证

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
gateway_test_config="$(mktemp -d)"
ANTIGRAVITY_GATEWAY_CONFIG_DIR="$gateway_test_config" npm test
gateway_test_status=$?
rm -rf "$gateway_test_config"
test "$gateway_test_status" -eq 0
npm pack --dry-run
```

测试必须使用隔离配置，不能读写维护者正在使用的账号池。删除自己创建且确认不再使用的测试目录。CI 在 Linux 上检查 Node 20 与 24；CI 不携带生产凭据、不消费真实模型额度，也不等同于生产验证。涉及并发、媒体、认证、代理或流式输出的修改，增加对应回归测试；真实环境验收只在获得部署授权的环境进行，保留回滚材料并清理测试媒体。

## English

This is the independently maintained Bailey distribution. Target contributions at this repository’s `main`; the current stability work is on `codex/bailey-stability`. Review upstream changes before integrating them and preserve attribution and the MIT license.

Keep both README languages, user-visible changelog entries and package versions consistent. Describe behavior, validation and limits in each PR. Use isolated test configuration and the commands above; CI covers Linux on Node 20 and 24 without production secrets or live model calls. Deployment acceptance is separate from unit tests. Never commit credentials or private operational records, and retain rollback evidence for authorized deployments.
