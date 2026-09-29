package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// AgentAuth 代理鉴权中间件。必须挂在 UserAuth() 之后使用：
// 它读取 UserAuth 写入上下文的 id，再校验该用户在 agents 表中的状态为「已通过」。
func AgentAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		id := c.GetInt("id")
		if id == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "无效的用户身份",
			})
			c.Abort()
			return
		}
		agent, err := model.GetAgentByUserId(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": "查询代理状态失败",
			})
			c.Abort()
			return
		}
		if agent == nil || agent.Status != model.AgentStatusApproved {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "您不是有效的代理，无权访问",
			})
			c.Abort()
			return
		}
		c.Set("agent_id", agent.Id)
		c.Next()
	}
}
