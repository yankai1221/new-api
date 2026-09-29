package model

import (
	crand "crypto/rand"
	"errors"
	"math/big"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 代理状态
const (
	AgentStatusPending  = 1 // 待审核
	AgentStatusApproved = 2 // 已通过
	AgentStatusRejected = 3 // 已拒绝
	AgentStatusDisabled = 4 // 已禁用
)

// agentCodeCharset 大写字母 + 数字，排除易混淆字符 0/O/1/I/L
const agentCodeCharset = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

const agentCodeLength = 8

// Agent 代理商。代理身份由本表状态决定，不新增用户角色。
// AgentCode 使用指针类型：待审核/拒绝态为 NULL，审核通过时生成；
// 这样多条未通过记录的空码不会触发 uniqueIndex 冲突（兼容 MySQL/PostgreSQL/SQLite）。
type Agent struct {
	Id           int     `json:"id"`
	UserId       int     `json:"user_id" gorm:"uniqueIndex"`
	Status       int     `json:"status" gorm:"type:int;default:1;index"`
	AgentCode    *string `json:"agent_code" gorm:"type:varchar(16);uniqueIndex"`
	ShopUrl      string  `json:"shop_url" gorm:"type:varchar(512)"`
	Contact      string  `json:"contact" gorm:"type:varchar(128)"`
	ApplyReason  string  `json:"apply_reason" gorm:"type:text"`
	AdminRemark  string  `json:"admin_remark,omitempty" gorm:"type:text"`
	RejectReason string  `json:"reject_reason" gorm:"type:varchar(255)"`
	CreatedTime  int64   `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64   `json:"updated_time" gorm:"bigint"`
	ApprovedTime int64   `json:"approved_time" gorm:"bigint"`
}

// GetAgentCode 安全读取代理码
func (a *Agent) GetAgentCode() string {
	if a.AgentCode == nil {
		return ""
	}
	return *a.AgentCode
}

func (a *Agent) setAgentCode(code string) {
	a.AgentCode = &code
}

// generateAgentCode 生成唯一代理码，冲突则重试
func generateAgentCode() (string, error) {
	maxI := big.NewInt(int64(len(agentCodeCharset)))
	for attempt := 0; attempt < 20; attempt++ {
		b := make([]byte, agentCodeLength)
		for i := range b {
			n, err := crand.Int(crand.Reader, maxI)
			if err != nil {
				return "", err
			}
			b[i] = agentCodeCharset[n.Int64()]
		}
		code := string(b)
		var count int64
		if err := DB.Model(&Agent{}).Where("agent_code = ?", code).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return code, nil
		}
	}
	return "", errors.New("生成代理码失败：多次冲突，请重试")
}

// GetAgentByUserId 按用户 id 获取代理记录；无记录返回 (nil, nil)
func GetAgentByUserId(userId int) (*Agent, error) {
	if userId == 0 {
		return nil, errors.New("user id 为空")
	}
	var agent Agent
	err := DB.Where("user_id = ?", userId).First(&agent).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &agent, nil
}

// GetAgentById 按主键获取代理记录
func GetAgentById(id int) (*Agent, error) {
	if id == 0 {
		return nil, errors.New("id 为空")
	}
	var agent Agent
	err := DB.First(&agent, "id = ?", id).Error
	return &agent, err
}

// GetActiveAgentByCode 按代理码获取「已通过」的代理；无效/非通过返回 (nil, nil)
func GetActiveAgentByCode(code string) (*Agent, error) {
	if code == "" {
		return nil, nil
	}
	var agent Agent
	err := DB.Where("agent_code = ? AND status = ?", code, AgentStatusApproved).First(&agent).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &agent, nil
}

// ResolveAgentIdByCode 解析代理码为归属代理的 user_id。
// 无效、非「已通过」、或等于 selfUserId（不能归属给自己）时返回 0。
func ResolveAgentIdByCode(code string, selfUserId int) int {
	agent, err := GetActiveAgentByCode(code)
	if err != nil || agent == nil {
		return 0
	}
	if agent.UserId == selfUserId {
		return 0
	}
	return agent.UserId
}

// ApplyAgent 提交或重新提交申请。
// 无记录则新建（status=1）；被拒绝的记录复用并回到 status=1；
// 待审核/已通过/已禁用状态不允许再次申请。
func ApplyAgent(userId int, contact, applyReason string) (*Agent, error) {
	if userId == 0 {
		return nil, errors.New("user id 为空")
	}
	now := common.GetTimestamp()
	agent, err := GetAgentByUserId(userId)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		agent = &Agent{
			UserId:      userId,
			Status:      AgentStatusPending,
			Contact:     contact,
			ApplyReason: applyReason,
			CreatedTime: now,
			UpdatedTime: now,
		}
		if err := DB.Create(agent).Error; err != nil {
			return nil, err
		}
		return agent, nil
	}
	switch agent.Status {
	case AgentStatusPending:
		return nil, errors.New("申请正在审核中，请勿重复提交")
	case AgentStatusApproved:
		return nil, errors.New("您已经是代理，无需申请")
	case AgentStatusDisabled:
		return nil, errors.New("您的代理资格已被禁用，请联系管理员")
	case AgentStatusRejected:
		// 允许重新申请：复用同一条记录
		updates := map[string]interface{}{
			"status":        AgentStatusPending,
			"contact":       contact,
			"apply_reason":  applyReason,
			"reject_reason": "",
			"updated_time":  now,
		}
		if err := DB.Model(&Agent{}).Where("id = ?", agent.Id).Updates(updates).Error; err != nil {
			return nil, err
		}
		return GetAgentById(agent.Id)
	default:
		return nil, errors.New("非法的代理状态")
	}
}

// ApproveAgent 审核通过：仅允许作用于待审核(1)。生成代理码（若尚无）。
func ApproveAgent(id int) (*Agent, error) {
	agent, err := GetAgentById(id)
	if err != nil {
		return nil, err
	}
	if agent.Status != AgentStatusPending {
		return nil, errors.New("只能通过「待审核」状态的申请")
	}
	code := agent.GetAgentCode()
	if code == "" {
		code, err = generateAgentCode()
		if err != nil {
			return nil, err
		}
	}
	now := common.GetTimestamp()
	updates := map[string]interface{}{
		"status":        AgentStatusApproved,
		"agent_code":    code,
		"reject_reason": "",
		"approved_time": now,
		"updated_time":  now,
	}
	if err := DB.Model(&Agent{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return GetAgentById(id)
}

// RejectAgent 拒绝：仅允许作用于待审核(1)。
func RejectAgent(id int, reason string) (*Agent, error) {
	agent, err := GetAgentById(id)
	if err != nil {
		return nil, err
	}
	if agent.Status != AgentStatusPending {
		return nil, errors.New("只能拒绝「待审核」状态的申请")
	}
	now := common.GetTimestamp()
	updates := map[string]interface{}{
		"status":        AgentStatusRejected,
		"reject_reason": reason,
		"updated_time":  now,
	}
	if err := DB.Model(&Agent{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return GetAgentById(id)
}

// DisableAgent 禁用：仅允许作用于已通过(2)。保留 agent_code。
func DisableAgent(id int) (*Agent, error) {
	agent, err := GetAgentById(id)
	if err != nil {
		return nil, err
	}
	if agent.Status != AgentStatusApproved {
		return nil, errors.New("只能禁用「已通过」状态的代理")
	}
	now := common.GetTimestamp()
	if err := DB.Model(&Agent{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":       AgentStatusDisabled,
		"updated_time": now,
	}).Error; err != nil {
		return nil, err
	}
	return GetAgentById(id)
}

// EnableAgent 恢复：仅允许作用于已禁用(4)。保留原 agent_code，不重新生成。
func EnableAgent(id int) (*Agent, error) {
	agent, err := GetAgentById(id)
	if err != nil {
		return nil, err
	}
	if agent.Status != AgentStatusDisabled {
		return nil, errors.New("只能恢复「已禁用」状态的代理")
	}
	now := common.GetTimestamp()
	if err := DB.Model(&Agent{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":       AgentStatusApproved,
		"updated_time": now,
	}).Error; err != nil {
		return nil, err
	}
	return GetAgentById(id)
}

// AdminCreateOrApproveAgent 管理员直接把某用户设为已通过代理。
// 已有记录（被拒/禁用/待审）则复用并置为已通过；已是已通过则报错。
func AdminCreateOrApproveAgent(userId int, adminRemark string) (*Agent, error) {
	if userId == 0 {
		return nil, errors.New("user id 为空")
	}
	// 校验用户存在
	if _, err := GetUserById(userId, false); err != nil {
		return nil, errors.New("目标用户不存在")
	}
	now := common.GetTimestamp()
	agent, err := GetAgentByUserId(userId)
	if err != nil {
		return nil, err
	}
	if agent != nil && agent.Status == AgentStatusApproved {
		return nil, errors.New("该用户已经是代理")
	}
	code, err := func() (string, error) {
		if agent != nil && agent.GetAgentCode() != "" {
			return agent.GetAgentCode(), nil
		}
		return generateAgentCode()
	}()
	if err != nil {
		return nil, err
	}
	if agent == nil {
		agent = &Agent{
			UserId:       userId,
			Status:       AgentStatusApproved,
			AdminRemark:  adminRemark,
			CreatedTime:  now,
			UpdatedTime:  now,
			ApprovedTime: now,
		}
		agent.setAgentCode(code)
		if err := DB.Create(agent).Error; err != nil {
			return nil, err
		}
		return agent, nil
	}
	// 复用现有记录（唯一索引在 user_id，不会冲突）
	updates := map[string]interface{}{
		"status":        AgentStatusApproved,
		"agent_code":    code,
		"reject_reason": "",
		"approved_time": now,
		"updated_time":  now,
	}
	if adminRemark != "" {
		updates["admin_remark"] = adminRemark
	}
	if err := DB.Model(&Agent{}).Where("id = ?", agent.Id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return GetAgentById(agent.Id)
}

// UpdateAgentByAdmin 管理员修改 shop_url / admin_remark
func UpdateAgentByAdmin(id int, shopUrl, adminRemark string) (*Agent, error) {
	agent, err := GetAgentById(id)
	if err != nil {
		return nil, err
	}
	updates := map[string]interface{}{
		"shop_url":     shopUrl,
		"admin_remark": adminRemark,
		"updated_time": common.GetTimestamp(),
	}
	if err := DB.Model(&Agent{}).Where("id = ?", agent.Id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return GetAgentById(agent.Id)
}

// SearchAgents 代理列表，可按状态筛选、按用户名搜索
func SearchAgents(status int, keyword string, startIdx, num int) ([]*Agent, int64, error) {
	var agents []*Agent
	var total int64

	query := DB.Model(&Agent{})
	if status != 0 {
		query = query.Where("status = ?", status)
	}
	if keyword != "" {
		// 通过用户名/显示名匹配用户，再按 user_id 过滤
		var userIds []int
		like := "%" + keyword + "%"
		if err := DB.Model(&User{}).
			Where("username LIKE ? OR display_name LIKE ?", like, like).
			Pluck("id", &userIds).Error; err != nil {
			return nil, 0, err
		}
		if len(userIds) == 0 {
			return []*Agent{}, 0, nil
		}
		query = query.Where("user_id IN ?", userIds)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&agents).Error; err != nil {
		return nil, 0, err
	}
	return agents, total, nil
}
