package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// agentWithUser 管理员列表返回结构：代理记录 + 归属用户名 + 统计（批量聚合，避免 N+1）
type agentWithUser struct {
	*model.Agent
	Username    string            `json:"username"`
	DisplayName string            `json:"display_name"`
	Stats       *model.AgentStats `json:"stats"`
}

func enrichAgentsWithUser(agents []*model.Agent) ([]*agentWithUser, error) {
	userIds := make([]int, 0, len(agents))
	for _, a := range agents {
		userIds = append(userIds, a.UserId)
	}
	briefs, err := model.GetUserBriefsByIds(userIds)
	if err != nil {
		return nil, err
	}
	statsMap, err := model.GetAgentStatsBatch(userIds)
	if err != nil {
		return nil, err
	}
	result := make([]*agentWithUser, 0, len(agents))
	for _, a := range agents {
		item := &agentWithUser{Agent: a, Stats: statsMap[a.UserId]}
		if b, ok := briefs[a.UserId]; ok {
			item.Username = b.Username
			item.DisplayName = b.DisplayName
		}
		result = append(result, item)
	}
	return result, nil
}

// parseAgentIdFilter 解析 ?agent_id= 过滤参数：缺省返回 -1(不过滤)，0 表示筛选未归属
func parseAgentIdFilter(c *gin.Context) int {
	raw := c.Query("agent_id")
	if raw == "" {
		return -1
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		return -1
	}
	return v
}

type userWithAgent struct {
	*model.User
	AgentUsername string `json:"agent_username"`
}

// attachAgentUsernameToUsers 批量补充归属代理用户名（避免 N+1）
func attachAgentUsernameToUsers(users []*model.User) ([]*userWithAgent, error) {
	ids := make([]int, 0)
	seen := make(map[int]bool)
	for _, u := range users {
		if u.AgentId != 0 && !seen[u.AgentId] {
			seen[u.AgentId] = true
			ids = append(ids, u.AgentId)
		}
	}
	m, err := model.GetUsernamesByIds(ids)
	if err != nil {
		return nil, err
	}
	out := make([]*userWithAgent, 0, len(users))
	for _, u := range users {
		out = append(out, &userWithAgent{User: u, AgentUsername: m[u.AgentId]})
	}
	return out, nil
}

type redemptionWithAgent struct {
	*model.Redemption
	AgentUsername string `json:"agent_username"`
}

// attachAgentUsernameToRedemptions 批量补充兑换码归属代理用户名（避免 N+1）
func attachAgentUsernameToRedemptions(reds []*model.Redemption) ([]*redemptionWithAgent, error) {
	ids := make([]int, 0)
	seen := make(map[int]bool)
	for _, r := range reds {
		if r.AgentId != 0 && !seen[r.AgentId] {
			seen[r.AgentId] = true
			ids = append(ids, r.AgentId)
		}
	}
	m, err := model.GetUsernamesByIds(ids)
	if err != nil {
		return nil, err
	}
	out := make([]*redemptionWithAgent, 0, len(reds))
	for _, r := range reds {
		out = append(out, &redemptionWithAgent{Redemption: r, AgentUsername: m[r.AgentId]})
	}
	return out, nil
}

// ==================== 用户侧（UserAuth） ====================

// GetAgentApply 查询自己的申请状态（含拒绝理由）
func GetAgentApply(c *gin.Context) {
	userId := c.GetInt("id")
	agent, err := model.GetAgentByUserId(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"apply_enabled": common.AgentApplyEnabled,
		"agent":         agent, // 无记录时为 null
	})
}

type agentApplyRequest struct {
	Contact     string `json:"contact"`
	ApplyReason string `json:"apply_reason"`
}

// ApplyForAgent 提交或重新提交代理申请
func ApplyForAgent(c *gin.Context) {
	if !common.AgentApplyEnabled {
		common.ApiErrorMsg(c, "代理申请暂未开放")
		return
	}
	userId := c.GetInt("id")
	var req agentApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.Contact = strings.TrimSpace(req.Contact)
	req.ApplyReason = strings.TrimSpace(req.ApplyReason)
	if req.Contact == "" {
		common.ApiErrorMsg(c, "请填写联系方式")
		return
	}
	if req.ApplyReason == "" {
		common.ApiErrorMsg(c, "请填写申请说明")
		return
	}
	if len(req.Contact) > 128 {
		common.ApiErrorMsg(c, "联系方式过长")
		return
	}
	agent, err := model.ApplyAgent(userId, req.Contact, req.ApplyReason)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, agent)
}

// ==================== 管理员侧（AdminAuth） ====================

// AdminListAgents 代理列表，可按状态筛选、搜索用户名
func AdminListAgents(c *gin.Context) {
	status, _ := strconv.Atoi(c.Query("status")) // 0 表示全部
	keyword := strings.TrimSpace(c.Query("keyword"))
	pageInfo := common.GetPageQuery(c)
	agents, total, err := model.SearchAgents(status, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items, err := enrichAgentsWithUser(agents)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func parseAgentIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的代理 id")
		return 0, false
	}
	return id, true
}

// AdminApproveAgent 审核通过
func AdminApproveAgent(c *gin.Context) {
	id, ok := parseAgentIdParam(c)
	if !ok {
		return
	}
	agent, err := model.ApproveAgent(id)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, agent)
}

type agentRejectRequest struct {
	RejectReason string `json:"reject_reason"`
}

// AdminRejectAgent 拒绝申请
func AdminRejectAgent(c *gin.Context) {
	id, ok := parseAgentIdParam(c)
	if !ok {
		return
	}
	var req agentRejectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.RejectReason = strings.TrimSpace(req.RejectReason)
	if req.RejectReason == "" {
		common.ApiErrorMsg(c, "请填写拒绝理由")
		return
	}
	if len(req.RejectReason) > 255 {
		common.ApiErrorMsg(c, "拒绝理由过长")
		return
	}
	agent, err := model.RejectAgent(id, req.RejectReason)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, agent)
}

// AdminDisableAgent 禁用代理
func AdminDisableAgent(c *gin.Context) {
	id, ok := parseAgentIdParam(c)
	if !ok {
		return
	}
	agent, err := model.DisableAgent(id)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, agent)
}

// AdminEnableAgent 恢复代理
func AdminEnableAgent(c *gin.Context) {
	id, ok := parseAgentIdParam(c)
	if !ok {
		return
	}
	agent, err := model.EnableAgent(id)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, agent)
}

type agentCreateRequest struct {
	UserId      int    `json:"user_id"`
	AdminRemark string `json:"admin_remark"`
}

// AdminCreateAgent 直接把某用户设为已通过代理（跳过申请）
func AdminCreateAgent(c *gin.Context) {
	var req agentCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.UserId <= 0 {
		common.ApiErrorMsg(c, "请提供有效的用户 id")
		return
	}
	agent, err := model.AdminCreateOrApproveAgent(req.UserId, strings.TrimSpace(req.AdminRemark))
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, agent)
}
