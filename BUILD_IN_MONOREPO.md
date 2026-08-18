# 在 monorepo 中生成/更新本目录

**契约范围**：`openapi-gateway` 合同（`backend/openapi/beeos-platform-v1.yaml`），
由 `openapi-gateway` 独立实现，与主 Gateway 已解耦。本 SDK 不再走 filter / 子集步骤。
提交前在 monorepo 中执行：

```bash
cd sdks/openapi-sdk
npm install
./generate.sh
```

`generate.sh` 会清空并重新写入 `sdks/beeos-ai-sdk/`，然后合并
`assets/beeos-ai-sdk/` 下的手维护文件（`README` / `LICENSE` / `.gitignore` /
`BUILD_IN_MONOREPO.md`）。

**独立 GitHub 仓库 / npm**：生成后将 `sdks/beeos-ai-sdk` 同步发布为 `@beeos-ai/sdk`。
