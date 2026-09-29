package model

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// currentMonthStartUnix 服务器时区当月 1 号 0 点的 Unix 秒
func currentMonthStartUnix() int64 {
	now := time.Now()
	y, m, _ := now.Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, now.Location()).Unix()
}

// AgentStats 代理统计口径
type AgentStats struct {
	UserCount               int64 `json:"user_count"`                // 名下用户总数
	MonthNewUserCount       int64 `json:"month_new_user_count"`      // 本月新增(自然月, created_time>0)
	DownstreamRedeemedQuota int64 `json:"downstream_redeemed_quota"` // 名下用户累计兑换额度(不论码来源)
	MyCodeRedeemedQuota     int64 `json:"my_code_redeemed_quota"`    // 其中使用本代理码的额度
	AllocatedTotal          int64 `json:"allocated_total"`           // 划拨码总数
	AllocatedUsed           int64 `json:"allocated_used"`            // 已使用
	AllocatedUnused         int64 `json:"allocated_unused"`          // 未使用
}

// GetAgentStatsBatch 批量聚合多个代理的统计，分组查询避免 N+1
func GetAgentStatsBatch(agentUserIds []int) (map[int]*AgentStats, error) {
	result := make(map[int]*AgentStats, len(agentUserIds))
	for _, id := range agentUserIds {
		result[id] = &AgentStats{}
	}
	if len(agentUserIds) == 0 {
		return result, nil
	}
	used := common.RedemptionCodeStatusUsed
	monthStart := currentMonthStartUnix()

	// 1. 名下用户总数
	type kvCnt struct {
		AgentId int
		Cnt     int64
	}
	var rows1 []kvCnt
	if err := DB.Model(&User{}).Select("agent_id, count(*) as cnt").
		Where("agent_id IN ?", agentUserIds).Group("agent_id").Scan(&rows1).Error; err != nil {
		return nil, err
	}
	for _, r := range rows1 {
		if s, ok := result[r.AgentId]; ok {
			s.UserCount = r.Cnt
		}
	}

	// 2. 本月新增(created_time>0 排除老用户)
	var rows2 []kvCnt
	if err := DB.Model(&User{}).Select("agent_id, count(*) as cnt").
		Where("agent_id IN ? AND created_time >= ? AND created_time > 0", agentUserIds, monthStart).
		Group("agent_id").Scan(&rows2).Error; err != nil {
		return nil, err
	}
	for _, r := range rows2 {
		if s, ok := result[r.AgentId]; ok {
			s.MonthNewUserCount = r.Cnt
		}
	}

	// 3. 划拨码 总数 & 已用
	type kvAlloc struct {
		AgentId   int
		Total     int64
		UsedCount int64
	}
	var rows3 []kvAlloc
	caseUsed := fmt.Sprintf("SUM(CASE WHEN status = %d THEN 1 ELSE 0 END) as used_count", used)
	if err := DB.Model(&Redemption{}).
		Select("agent_id, count(*) as total, "+caseUsed).
		Where("agent_id IN ?", agentUserIds).Group("agent_id").Scan(&rows3).Error; err != nil {
		return nil, err
	}
	for _, r := range rows3 {
		if s, ok := result[r.AgentId]; ok {
			s.AllocatedTotal = r.Total
			s.AllocatedUsed = r.UsedCount
			s.AllocatedUnused = r.Total - r.UsedCount
		}
	}

	// 4. 名下用户累计兑换额度(不论码来源): join 兑换码.used_user_id -> 用户.agent_id
	type kvQuota struct {
		AgentId int
		Total   int64
	}
	var rows4 []kvQuota
	if err := DB.Table("redemptions as r").
		Select("u.agent_id as agent_id, COALESCE(SUM(r.quota),0) as total").
		Joins("JOIN users as u ON u.id = r.used_user_id").
		Where("u.agent_id IN ? AND r.status = ? AND r.deleted_at IS NULL AND u.deleted_at IS NULL", agentUserIds, used).
		Group("u.agent_id").Scan(&rows4).Error; err != nil {
		return nil, err
	}
	for _, r := range rows4 {
		if s, ok := result[r.AgentId]; ok {
			s.DownstreamRedeemedQuota = r.Total
		}
	}

	// 5. 其中"使用本代理码"的额度: 名下用户使用的、且码归属本代理
	var rows5 []kvQuota
	if err := DB.Table("redemptions as r").
		Select("r.agent_id as agent_id, COALESCE(SUM(r.quota),0) as total").
		Joins("JOIN users as u ON u.id = r.used_user_id").
		Where("r.agent_id IN ? AND u.agent_id = r.agent_id AND r.status = ? AND r.deleted_at IS NULL AND u.deleted_at IS NULL", agentUserIds, used).
		Group("r.agent_id").Scan(&rows5).Error; err != nil {
		return nil, err
	}
	for _, r := range rows5 {
		if s, ok := result[r.AgentId]; ok {
			s.MyCodeRedeemedQuota = r.Total
		}
	}

	return result, nil
}

// GetAgentStats 单个代理统计
func GetAgentStats(agentUserId int) (*AgentStats, error) {
	m, err := GetAgentStatsBatch([]int{agentUserId})
	if err != nil {
		return nil, err
	}
	return m[agentUserId], nil
}

// ==================== 代理侧数据查询（均以 agentUserId 过滤） ====================

// GetAgentDownstreamUsers 名下用户分页列表，支持按用户名/ID搜索
func GetAgentDownstreamUsers(agentUserId int, keyword string, startIdx, num int) ([]*User, int64, error) {
	var users []*User
	var total int64
	q := DB.Model(&User{}).Where("agent_id = ?", agentUserId)
	if keyword != "" {
		like := "%" + keyword + "%"
		if idv, e := strconv.Atoi(keyword); e == nil {
			q = q.Where("id = ? OR username LIKE ? OR display_name LIKE ?", idv, like, like)
		} else {
			q = q.Where("username LIKE ? OR display_name LIKE ?", like, like)
		}
	}
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Omit("password").Order("id desc").Limit(num).Offset(startIdx).Find(&users).Error
	return users, total, err
}

// VerifyUserBelongsToAgent 校验目标用户是否归属该代理
func VerifyUserBelongsToAgent(agentUserId, targetUserId int) (bool, error) {
	var cnt int64
	err := DB.Model(&User{}).Where("id = ? AND agent_id = ?", targetUserId, agentUserId).Count(&cnt).Error
	return cnt > 0, err
}

// UserRedemptionRecord 代理查看名下用户兑换记录的条目（key 仅本代理码返回）
type UserRedemptionRecord struct {
	Id           int    `json:"id"`
	Quota        int    `json:"quota"`
	RedeemedTime int64  `json:"redeemed_time"`
	IsMine       bool   `json:"is_mine"`
	Key          string `json:"key,omitempty"`
}

// GetAgentUserRedemptionRecords 返回某名下用户使用过的全部兑换记录
func GetAgentUserRedemptionRecords(targetUserId, agentUserId int) ([]*UserRedemptionRecord, error) {
	var reds []*Redemption
	err := DB.Where("used_user_id = ? AND status = ?", targetUserId, common.RedemptionCodeStatusUsed).
		Order("redeemed_time desc").Find(&reds).Error
	if err != nil {
		return nil, err
	}
	out := make([]*UserRedemptionRecord, 0, len(reds))
	for _, r := range reds {
		rec := &UserRedemptionRecord{
			Id:           r.Id,
			Quota:        r.Quota,
			RedeemedTime: r.RedeemedTime,
			IsMine:       r.AgentId == agentUserId,
		}
		if rec.IsMine {
			rec.Key = r.Key
		}
		out = append(out, rec)
	}
	return out, nil
}

// GetAgentRedemptions 划拨给该代理的兑换码列表，statusFilter: unused/used/expired/空(全部)
func GetAgentRedemptions(agentUserId int, statusFilter string, startIdx, num int) ([]*Redemption, int64, error) {
	now := common.GetTimestamp()
	enabled := common.RedemptionCodeStatusEnabled
	used := common.RedemptionCodeStatusUsed
	q := DB.Model(&Redemption{}).Where("agent_id = ?", agentUserId)
	switch statusFilter {
	case "unused":
		q = q.Where("status = ? AND (expired_time = 0 OR expired_time > ?)", enabled, now)
	case "used":
		q = q.Where("status = ?", used)
	case "expired":
		q = q.Where("status = ? AND expired_time != 0 AND expired_time < ?", enabled, now)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var reds []*Redemption
	err := q.Order("id desc").Limit(num).Offset(startIdx).Find(&reds).Error
	return reds, total, err
}

// GetAgentExportableRedemptions 导出用：未使用且未过期的码
func GetAgentExportableRedemptions(agentUserId int) ([]*Redemption, error) {
	now := common.GetTimestamp()
	var reds []*Redemption
	err := DB.Where("agent_id = ? AND status = ? AND (expired_time = 0 OR expired_time > ?)",
		agentUserId, common.RedemptionCodeStatusEnabled, now).Order("id desc").Find(&reds).Error
	return reds, err
}

// GetAgentAllocationLogs 划拨记录分页
func GetAgentAllocationLogs(agentUserId, startIdx, num int) ([]*AgentAllocationLog, int64, error) {
	var logs []*AgentAllocationLog
	var total int64
	q := DB.Model(&AgentAllocationLog{}).Where("agent_id = ?", agentUserId)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Order("id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	return logs, total, err
}

// ==================== 划拨 / 收回（事务） ====================

// AllocateNewCodes 模式A：生成新码并划拨给代理，事务内同时写划拨日志
func AllocateNewCodes(agentUserId, operatorId, count, quota int, name string, expiredTime int64, paidAmount, remark string) ([]string, error) {
	if count <= 0 {
		return nil, errors.New("数量必须大于 0")
	}
	if count > 500 {
		return nil, errors.New("单次生成数量不能超过 500")
	}
	if quota <= 0 {
		return nil, errors.New("单码额度必须大于 0")
	}
	now := common.GetTimestamp()
	var keys []string
	err := DB.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < count; i++ {
			key := common.GetUUID()
			r := &Redemption{
				UserId:        operatorId,
				Name:          name,
				Key:           key,
				Status:        common.RedemptionCodeStatusEnabled,
				Quota:         quota,
				CreatedTime:   now,
				ExpiredTime:   expiredTime,
				AgentId:       agentUserId,
				AllocatedTime: now,
			}
			if err := tx.Create(r).Error; err != nil {
				return err
			}
			keys = append(keys, key)
		}
		log := &AgentAllocationLog{
			AgentId:      agentUserId,
			OperatorId:   operatorId,
			Type:         AgentAllocationTypeNewCodes,
			CodeCount:    count,
			QuotaPerCode: quota,
			TotalQuota:   count * quota,
			PaidAmount:   paidAmount,
			Remark:       remark,
			CreatedTime:  now,
		}
		return tx.Create(log).Error
	})
	if err != nil {
		return nil, err
	}
	return keys, nil
}

// AllocateExistingCodes 模式B：划拨已有码。只能选未使用+未过期+agent_id=0 的码。
// 有任一不合格 -> 整批失败，返回不合格 id 列表(invalid 非空, err=nil)。
func AllocateExistingCodes(agentUserId, operatorId int, ids []int, paidAmount, remark string) (invalid []int, err error) {
	if len(ids) == 0 {
		return nil, errors.New("未选择兑换码")
	}
	now := common.GetTimestamp()
	var reds []*Redemption
	if err = DB.Where("id IN ?", ids).Find(&reds).Error; err != nil {
		return nil, err
	}
	found := make(map[int]*Redemption, len(reds))
	for _, r := range reds {
		found[r.Id] = r
	}
	total := 0
	for _, id := range ids {
		r, ok := found[id]
		if !ok || r.Status != common.RedemptionCodeStatusEnabled || r.AgentId != 0 ||
			(r.ExpiredTime != 0 && r.ExpiredTime < now) {
			invalid = append(invalid, id)
			continue
		}
		total += r.Quota
	}
	if len(invalid) > 0 {
		return invalid, nil
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&Redemption{}).
			Where("id IN ? AND status = ? AND agent_id = 0", ids, common.RedemptionCodeStatusEnabled).
			Updates(map[string]interface{}{"agent_id": agentUserId, "allocated_time": now})
		if res.Error != nil {
			return res.Error
		}
		if int(res.RowsAffected) != len(ids) {
			return errors.New("部分兑换码状态已变化，请刷新后重试")
		}
		log := &AgentAllocationLog{
			AgentId:      agentUserId,
			OperatorId:   operatorId,
			Type:         AgentAllocationTypeExisting,
			CodeCount:    len(ids),
			QuotaPerCode: 0,
			TotalQuota:   total,
			PaidAmount:   paidAmount,
			Remark:       remark,
			CreatedTime:  now,
		}
		return tx.Create(log).Error
	})
	return nil, err
}

// RevokeCodes 收回：只能收回属于该代理且未使用的码。agent_id 置 0，事务内写收回日志。
func RevokeCodes(agentUserId, operatorId int, ids []int, remark string) (invalid []int, err error) {
	if len(ids) == 0 {
		return nil, errors.New("未选择兑换码")
	}
	now := common.GetTimestamp()
	var reds []*Redemption
	if err = DB.Where("id IN ?", ids).Find(&reds).Error; err != nil {
		return nil, err
	}
	found := make(map[int]*Redemption, len(reds))
	for _, r := range reds {
		found[r.Id] = r
	}
	total := 0
	for _, id := range ids {
		r, ok := found[id]
		if !ok || r.AgentId != agentUserId || r.Status != common.RedemptionCodeStatusEnabled {
			invalid = append(invalid, id)
			continue
		}
		total += r.Quota
	}
	if len(invalid) > 0 {
		return invalid, nil
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&Redemption{}).
			Where("id IN ? AND agent_id = ? AND status = ?", ids, agentUserId, common.RedemptionCodeStatusEnabled).
			Updates(map[string]interface{}{"agent_id": 0, "allocated_time": 0})
		if res.Error != nil {
			return res.Error
		}
		if int(res.RowsAffected) != len(ids) {
			return errors.New("部分兑换码状态已变化，请刷新后重试")
		}
		log := &AgentAllocationLog{
			AgentId:      agentUserId,
			OperatorId:   operatorId,
			Type:         AgentAllocationTypeRevoke,
			CodeCount:    len(ids),
			QuotaPerCode: 0,
			TotalQuota:   total,
			Remark:       remark,
			CreatedTime:  now,
		}
		return tx.Create(log).Error
	})
	return nil, err
}
