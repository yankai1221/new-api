package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

// ==================== 代理侧（AgentAuth，均以当前登录代理 user_id 过滤） ====================

// GetAgentSelf 代理信息：agent_code、完整推广链接、shop_url、统计
func GetAgentSelf(c *gin.Context) {
	userId := c.GetInt("id")
	agent, err := model.GetAgentByUserId(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if agent == nil {
		common.ApiErrorMsg(c, "代理信息不存在")
		return
	}
	stats, err := model.GetAgentStats(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	code := agent.GetAgentCode()
	addr := strings.TrimRight(system_setting.ServerAddress, "/")
	link := ""
	if code != "" && addr != "" {
		link = addr + "/register?agent=" + code
	}
	// 显式字段，不含 admin_remark
	common.ApiSuccess(c, gin.H{
		"agent_code":     code,
		"promotion_link": link,
		"shop_url":       agent.ShopUrl,
		"status":         agent.Status,
		"contact":        agent.Contact,
		"stats":          stats,
	})
}

type agentUpdateSelfRequest struct {
	ShopUrl string `json:"shop_url"`
}

// UpdateAgentSelf 代理本人仅可修改 shop_url
func UpdateAgentSelf(c *gin.Context) {
	userId := c.GetInt("id")
	var req agentUpdateSelfRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.ShopUrl = strings.TrimSpace(req.ShopUrl)
	if err := model.ValidateShopUrl(req.ShopUrl); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.UpdateAgentShopUrlByUserId(userId, req.ShopUrl); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"shop_url": req.ShopUrl})
}

// agentUserView 代理可见的名下用户信息（邮箱打码，无敏感字段）
type agentUserView struct {
	Id           int    `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Email        string `json:"email"`
	CreatedTime  int64  `json:"created_time"`
	Quota        int    `json:"quota"`
	UsedQuota    int    `json:"used_quota"`
	RequestCount int    `json:"request_count"`
}

// GetAgentUsers 名下用户分页列表（当前代理）
func GetAgentUsers(c *gin.Context) {
	userId := c.GetInt("id")
	keyword := strings.TrimSpace(c.Query("keyword"))
	pageInfo := common.GetPageQuery(c)
	users, total, err := model.GetAgentDownstreamUsers(userId, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]*agentUserView, 0, len(users))
	for _, u := range users {
		views = append(views, &agentUserView{
			Id:           u.Id,
			Username:     u.Username,
			DisplayName:  u.DisplayName,
			Email:        model.MaskEmail(u.Email),
			CreatedTime:  u.CreatedTime,
			Quota:        u.Quota,
			UsedQuota:    u.UsedQuota,
			RequestCount: u.RequestCount,
		})
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

// GetAgentUserRedemptions 查看某名下用户的兑换记录（需校验归属）
func GetAgentUserRedemptions(c *gin.Context) {
	userId := c.GetInt("id")
	targetId, err := strconv.Atoi(c.Param("id"))
	if err != nil || targetId <= 0 {
		common.ApiErrorMsg(c, "无效的用户 id")
		return
	}
	belongs, err := model.VerifyUserBelongsToAgent(userId, targetId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !belongs {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "该用户不属于您，无权查看"})
		return
	}
	records, err := model.GetAgentUserRedemptionRecords(targetId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, records)
}

// GetAgentRedemptions 划拨给当前代理的兑换码列表（可按状态筛选，显示明文 key）
func GetAgentRedemptions(c *gin.Context) {
	userId := c.GetInt("id")
	status := c.Query("status") // unused/used/expired/空
	pageInfo := common.GetPageQuery(c)
	reds, total, err := model.GetAgentRedemptions(userId, status, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(reds)
	common.ApiSuccess(c, pageInfo)
}

// ExportAgentRedemptions 导出未使用且未过期的码（txt，每行一个）
func ExportAgentRedemptions(c *gin.Context) {
	userId := c.GetInt("id")
	reds, err := model.GetAgentExportableRedemptions(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var b strings.Builder
	for _, r := range reds {
		b.WriteString(r.Key)
		b.WriteString("\n")
	}
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=redemption_codes.txt")
	c.String(http.StatusOK, b.String())
}

// ==================== 管理员侧（AdminAuth） ====================

// getApprovedAgentByRecordId 按代理记录 id 取已通过代理
func getApprovedAgentByRecordId(c *gin.Context) (*model.Agent, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的代理 id")
		return nil, false
	}
	agent, err := model.GetAgentById(id)
	if err != nil {
		common.ApiErrorMsg(c, "代理不存在")
		return nil, false
	}
	if agent.Status != model.AgentStatusApproved {
		common.ApiErrorMsg(c, "该代理不是「已通过」状态，无法操作")
		return nil, false
	}
	return agent, true
}

type agentUpdateByAdminRequest struct {
	ShopUrl     string `json:"shop_url"`
	AdminRemark string `json:"admin_remark"`
}

// AdminUpdateAgent 管理员修改 shop_url、admin_remark
func AdminUpdateAgent(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的代理 id")
		return
	}
	var req agentUpdateByAdminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.ShopUrl = strings.TrimSpace(req.ShopUrl)
	if err := model.ValidateShopUrl(req.ShopUrl); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	agent, err := model.UpdateAgentByAdmin(id, req.ShopUrl, req.AdminRemark)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, agent)
}

type allocateRequest struct {
	Mode          string `json:"mode"` // new / existing
	Count         int    `json:"count"`
	Quota         int    `json:"quota"`
	Name          string `json:"name"`
	ExpiredTime   int64  `json:"expired_time"`
	RedemptionIds []int  `json:"redemption_ids"`
	PaidAmount    string `json:"paid_amount"`
	Remark        string `json:"remark"`
}

// AdminAllocateCodes 划拨兑换码给代理（模式A 生成新码 / 模式B 划拨已有码）
func AdminAllocateCodes(c *gin.Context) {
	agent, ok := getApprovedAgentByRecordId(c)
	if !ok {
		return
	}
	operatorId := c.GetInt("id")
	var req allocateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	switch req.Mode {
	case "new":
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" {
			common.ApiErrorMsg(c, "请填写兑换码名称")
			return
		}
		keys, err := model.AllocateNewCodes(agent.UserId, operatorId, req.Count, req.Quota, req.Name, req.ExpiredTime, strings.TrimSpace(req.PaidAmount), req.Remark)
		if err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		common.ApiSuccess(c, gin.H{"mode": "new", "count": len(keys), "keys": keys})
	case "existing":
		invalid, err := model.AllocateExistingCodes(agent.UserId, operatorId, req.RedemptionIds, strings.TrimSpace(req.PaidAmount), req.Remark)
		if err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		if len(invalid) > 0 {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "存在不符合条件的兑换码（需未使用、未过期、且未归属其他代理）", "data": gin.H{"invalid_ids": invalid}})
			return
		}
		common.ApiSuccess(c, gin.H{"mode": "existing", "count": len(req.RedemptionIds)})
	default:
		common.ApiErrorMsg(c, "无效的划拨模式")
	}
}

type revokeRequest struct {
	RedemptionIds []int  `json:"redemption_ids"`
	Remark        string `json:"remark"`
}

// AdminRevokeCodes 收回代理未使用的码
func AdminRevokeCodes(c *gin.Context) {
	agent, ok := getApprovedAgentByRecordId(c)
	if !ok {
		return
	}
	operatorId := c.GetInt("id")
	var req revokeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	invalid, err := model.RevokeCodes(agent.UserId, operatorId, req.RedemptionIds, req.Remark)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if len(invalid) > 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "存在不可收回的兑换码（需属于该代理且未使用）", "data": gin.H{"invalid_ids": invalid}})
		return
	}
	common.ApiSuccess(c, gin.H{"count": len(req.RedemptionIds)})
}

// AdminGetAgentAllocationLogs 划拨记录
func AdminGetAgentAllocationLogs(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的代理 id")
		return
	}
	agent, err := model.GetAgentById(id)
	if err != nil {
		common.ApiErrorMsg(c, "代理不存在")
		return
	}
	pageInfo := common.GetPageQuery(c)
	logs, total, err := model.GetAgentAllocationLogs(agent.UserId, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

// AdminGetAgentUsers 管理员查看某代理名下用户（完整信息，不打码）
func AdminGetAgentUsers(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的代理 id")
		return
	}
	agent, err := model.GetAgentById(id)
	if err != nil {
		common.ApiErrorMsg(c, "代理不存在")
		return
	}
	keyword := strings.TrimSpace(c.Query("keyword"))
	pageInfo := common.GetPageQuery(c)
	users, total, err := model.GetAgentDownstreamUsers(agent.UserId, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(users)
	common.ApiSuccess(c, pageInfo)
}

type reassignAgentRequest struct {
	AgentId int `json:"agent_id"` // 0 表示取消归属
}

// AdminReassignUserAgent 修改某用户的归属代理
func AdminReassignUserAgent(c *gin.Context) {
	targetUserId, err := strconv.Atoi(c.Param("id"))
	if err != nil || targetUserId <= 0 {
		common.ApiErrorMsg(c, "无效的用户 id")
		return
	}
	var req reassignAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ReassignUserAgent(targetUserId, req.AgentId); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{"user_id": targetUserId, "agent_id": req.AgentId})
}
