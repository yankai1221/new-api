# 代理商功能 · 上线部署说明

适用分支：`agent-feature`（基于 `stable-version`）
目标环境：Zeabur（GitHub 分支 + Dockerfile 自动构建）+ PostgreSQL + Redis

---

## 一、功能说明（面向管理员）

代理商功能让"介于普通用户和管理员之间"的分销角色（代理）帮你推广并销售兑换码。代理身份由新表 `agents` 的状态决定，**不新增用户角色**，普通用户和管理员都可以申请（管理员不使用"代理中心"，统一在"代理管理"操作）。

- **代理申请与审核**：用户在「个人中心 → 代理中心」提交申请（联系方式 + 申请说明）；管理员在「管理员 → 代理管理」审核（通过/拒绝，拒绝需填理由），或"直接设为代理"。
- **专属推广链接**：审核通过后生成 8 位代理码，推广链接为 `https://<服务器地址>/register?agent=<代理码>`。通过该链接注册的用户归属到该代理名下（`users.agent_id`）。仅一级代理，代理码无效/非"已通过"时忽略，注册照常。
- **代理自定义商城链接**：代理可填自己的店铺地址。其名下用户在钱包页的"购买兑换码 / 前往购买"入口会跳转到代理店铺；否则用后台全局商城链接；全局为空时回退到充值链接（TopUpLink）。
- **兑换码划拨**：管理员把兑换码划拨给代理（模式A 生成新码；模式B 划拨已有未使用/未过期/未归属的码），代理在自己店铺加价出售。系统不做自动分佣。兑换码归属仅用于统计对账，**兑换时不限制使用者**。
- **代理侧只读视图**：代理可查看名下用户（邮箱打码）、名下用户兑换记录（仅本代理码显示明文 key）、划拨给自己的兑换码（可导出未使用码）、统计数据。
- **管理员**：代理列表/审核/禁用启用、代理详情抽屉（基本信息/名下用户/兑换码/划拨记录/划拨兑换码）、收回未使用码、修改用户归属；用户/兑换码列表新增"归属代理"列与"按代理筛选"。

---

## 二、上线前必须做的事

1. **备份数据库**（PostgreSQL）：
   ```bash
   pg_dump -h <host> -U <user> -d <db> -Fc -f backup-before-agent.dump
   ```
   保留该备份以便回滚。
2. **设置"服务器地址"（关键）**：系统设置 → 填写 `ServerAddress`（如 `https://your-domain.com`）。
   - 推广链接域名**只来自 ServerAddress**，不依赖请求 Host/localhost。未设置时代理中心/详情抽屉会提示"尚未配置服务器地址，暂无法生成推广链接"。
3. **配置全局商城链接（可选）**：运营设置 → "兑换码商城链接（全局默认）"（必须 http/https）。默认沿用原前端硬编码地址 `https://pay.ldxp.cn/shop/Z7VYZN0E`（升级后首次由代码默认值写入内存，可在后台覆盖）。
4. **确认"开放代理申请"开关**（运营设置，默认开启）。
5. **确认 Zeabur 构建分支**指向 `agent-feature`，Dockerfile 构建（见第五节）。

---

## 三、数据库变更清单

启动时由 GORM `AutoMigrate` 自动执行（`model/main.go` 的 `migrateDB()` / `migrateDBFast()`），**无需手动 SQL**。三库（SQLite/MySQL/PostgreSQL）兼容。

### 新增表
| 表 | 说明 |
|---|---|
| `agents` | 代理记录。字段：`id, user_id(uniqueIndex), status(index), agent_code(varchar16, uniqueIndex, 指针/可空), shop_url(varchar512), contact(varchar128), apply_reason(text), admin_remark(text), reject_reason(varchar255), created_time/updated_time/approved_time(bigint)` |
| `agent_allocation_logs` | 划拨/收回记录。字段：`id, agent_id(index), operator_id, type, code_count, quota_per_code, total_quota, paid_amount(varchar64), remark(text), created_time` |

### 新增字段
| 表 | 字段 | 说明 |
|---|---|---|
| `users` | `agent_id int default 0, index` | 归属代理的 user_id，0=无归属 |
| `users` | `created_time bigint default 0` | 注册时间；**老用户为 0**（前端显示"-"） |
| `redemptions` | `agent_id int default 0, index` | 归属代理的 user_id，0=未归属 |
| `redemptions` | `allocated_time bigint default 0` | 划拨时间 |

> `agent_code` 使用可空唯一索引（未通过态为 NULL），三库均允许多个 NULL 并存，避免空串唯一冲突。`agents`/日志表的 `text` 字段不设默认值（兼容 MySQL）。

### 新增 Option（存 `options` 表，走 OptionMap）
| Key | 默认 | 说明 |
|---|---|---|
| `RedemptionShopUrl` | 原硬编码商城地址 | 全局兑换码商城链接 |
| `AgentApplyEnabled` | `true` | 是否开放代理申请 |

---

## 四、上线后验证清单

1. **迁移成功**：启动日志无迁移报错；`agents`/`agent_allocation_logs` 已建表，`users`/`redemptions` 新列存在。
2. **老数据完整**：随机抽查老用户余额、邀请关系（`inviter_id`）、老兑换码状态均不变；老用户 `agent_id=0`、`created_time=0`。
3. **服务器地址**：代理中心/详情抽屉能生成正确的推广链接（域名 = ServerAddress）。
4. **核心流程**：申请 → 审核通过（生成代理码）→ 用推广链接注册 → 名下用户 `agent_id` 正确 → 划拨(A/B) → 代理查看/导出 → 名下用户兑换 → 统计正确 → 收回 → 划拨日志完整。
5. **商城链接回退**：无归属用户=全局；归属且代理填了链接=代理店铺；代理禁用/未填=全局；全局空=TopUpLink。
6. **列表与筛选**：用户/兑换码列表显示"归属代理"，"按代理筛选"生效。
7. **权限**：普通用户/已禁用代理访问 `/api/agent/*` 被拒；代理只能看自己的数据。
8. **回归**：普通用户正常兑换、原有兑换码增删改查、普通邀请返利、钱包充值均不受影响。

---

## 五、Dockerfile / Zeabur 构建

现有 `Dockerfile` 多阶段构建，**无需修改**，已验证可构建新前后端：
1. **前端阶段**（`oven/bun`）：`COPY web/package.json` + `COPY web/bun.lock` + `bun install` → `COPY ./web .` → `bun run build`。
   - `web/bun.lock` 已提交且与 `package.json` 一致（`bun install --frozen-lockfile` 通过）。
   - 仅依赖仓库内 `web/` 文件，无本地私有依赖。
2. **后端阶段**（`golang:1.26 alpine`，`CGO_ENABLED=0`）：`ADD go.mod go.sum` → `go mod download` → `COPY . .` → `COPY --from=builder /build/dist ./web/dist` → `go build`。
   - 本功能**未新增任何第三方 Go 依赖**（仅用标准库 crypto/rand、math/big、time 等），`go.mod`/`go.sum` 未变。
   - `web/dist` 由前端阶段产出（不依赖仓库内 dist）。
   - PostgreSQL 驱动 `gorm.io/driver/postgres`（纯 Go）、SQLite 驱动 `glebarez/sqlite`（纯 Go），`CGO_ENABLED=0` 可正常编译。

### Zeabur 环境变量（建议）
| 变量 | 说明 |
|---|---|
| `SQL_DSN` | PostgreSQL DSN，如 `postgres://user:pass@host:5432/dbname` |
| `REDIS_CONN_STRING` | Redis 连接串（启用缓存/多实例） |
| `SESSION_SECRET` | 固定的随机串（多实例必须一致，否则会话失效） |
| `CRYPTO_SECRET` | 建议设置（多实例一致） |
| `TZ` | 时区，如 `Asia/Shanghai`（影响"本月新增"自然月统计） |

---

## 六、Redis / 多实例注意事项

- **改归属、改商城链接即时生效**：`shop_url` / `agent_id` / `agent_status` 均直连数据库读取（不进 Redis 用户缓存，`UserCache` 不含这些字段），无缓存陈旧问题。
- **Option 跨实例同步**：`RedemptionShopUrl` / `AgentApplyEnabled` 与所有既有 Option 一样，通过 `SyncOptions` **定时轮询数据库**同步到各实例内存（非 Redis 发布订阅）。多实例下修改后有"最多一个同步周期"的传播延迟；单实例（Zeabur 默认）立即生效。这与 `TopUpLink` 等现有配置行为完全一致。
- `/api/status` 下发的 `redemption_shop_url` / `agent_apply_enabled` 读内存变量，前端会缓存到 localStorage，用户刷新后获取最新（与其它 status 字段一致）。
- agents / agent_allocation_logs 表不做 Redis 缓存，均实时读库。

---

## 七、回滚方法

1. **代码回滚**：把部署分支回退到上线前的提交 `c8df66c`（`stable-version` 原 tip），Zeabur 重新构建即可。
2. **新增表/字段对旧版本无影响**：
   - 旧版本代码**不会读写** `agents`/`agent_allocation_logs` 表，也不读 `users.agent_id/created_time`、`redemptions.agent_id/allocated_time`（GORM 只操作模型中声明的字段）。这些多出来的表/列对旧版本是"惰性存在"，**不需要删除即可安全回退**。
   - 因此回滚代码后旧版本可直接在同一数据库上运行；无需 down migration。
3. **数据回滚（仅在必要时）**：如需彻底清除，可在停机并备份后手动 `DROP TABLE agents, agent_allocation_logs;` 并 `ALTER TABLE users DROP COLUMN agent_id, DROP COLUMN created_time; ALTER TABLE redemptions DROP COLUMN agent_id, DROP COLUMN allocated_time;`（PostgreSQL 支持 DROP COLUMN；一般无需执行）。
4. **兑换码/归属数据**：回滚不影响老兑换码与用户余额；代理相关归属信息保留在库中，再次上线可继续使用。
