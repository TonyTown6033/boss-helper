# TODO

本文件记录面向开发协作的任务索引。面向用户的功能路线仍保留在 [README.md](README.md#todo)。

## 文档与项目治理

- [x] 文档框架初始化 - [设计说明](docs/project/documentation-framework-design.md)

## 职位采集

- [ ] Boss 职位采集导出 - [设计说明](docs/crawler/boss-job-export-design.md)
- [ ] 采集导出岗位级节流 - [设计说明](docs/crawler/boss-job-export-design.md)
- [ ] 采集导出最大覆盖策略 - [设计说明](docs/crawler/boss-job-export-design.md)

## 使用约定

- 新功能、功能扩展或较大的行为变更，先在本文件登记任务，并链接到 `docs/` 下的设计文档。
- 小范围功能至少创建 `<feature>-design.md`；涉及接口、数据迁移或高风险流程时，补充对应的 API 契约、迁移说明或测试计划。
- 产品代码变更前，确认任务条目和文档链接存在并可追踪。
