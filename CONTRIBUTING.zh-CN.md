# 贡献指南

感谢你参与 Fund Estimation System。

## 1）提交流程

1. Fork 本仓库
2. 从 `main` 创建分支
3. 完成修改
4. 必要时补充/更新测试
5. 确保检查通过
6. 提交 Pull Request

```bash
git checkout -b feat/your-change
npm test
npm run build
```

## 2）提交规范

建议使用 Conventional Commits：

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `test: ...`

## 3）代码要求

- 保持 TypeScript 严格、可读
- 若要变更 API 契约，请先讨论
- UI 需遵循现有设计 token
- 用户可见行为变化需同步更新文档

## 4）PR 检查清单

- [ ] PR 描述清晰说明目的和范围
- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] 未引入密钥或本机路径
- [ ] README/文档已更新（如有行为变化）

## 5）问题反馈

提交 Issue 时请尽量提供：

- 期望行为
- 实际行为
- 复现步骤
- 日志或截图（如有）
- 环境信息（OS、Node 版本）

## 6）安全问题

敏感漏洞请勿公开提交 Issue，建议先私下联系维护者。
