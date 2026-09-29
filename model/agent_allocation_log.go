package model

// 划拨类型
const (
	AgentAllocationTypeNewCodes = 1 // 新生成后划拨
	AgentAllocationTypeExisting = 2 // 划拨已有未使用的码
	AgentAllocationTypeRevoke   = 3 // 收回
)

// AgentAllocationLog 兑换码划拨/收回记录，用于对账。
// 阶段 1 仅定义结构体并纳入迁移，业务写入在阶段 2 实现。
type AgentAllocationLog struct {
	Id           int    `json:"id"`
	AgentId      int    `json:"agent_id" gorm:"index"`               // 代理的 user_id
	OperatorId   int    `json:"operator_id"`                         // 执行划拨的管理员 id
	Type         int    `json:"type"`                                // 1 新生成后划拨 2 划拨已有 3 收回
	CodeCount    int    `json:"code_count"`                          // 本次涉及的码数量
	QuotaPerCode int    `json:"quota_per_code"`                      // 单码额度，混合时为 0
	TotalQuota   int    `json:"total_quota"`                         // 总额度
	PaidAmount   string `json:"paid_amount" gorm:"type:varchar(64)"` // 代理实付金额，管理员手填，可空
	Remark       string `json:"remark" gorm:"type:text"`
	CreatedTime  int64  `json:"created_time" gorm:"bigint"`
}
