package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mustMigrateAgentTables 确保代理相关表已迁移（TestMain 中未包含）
func mustMigrateAgentTables(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Agent{}, &AgentAllocationLog{}, &Redemption{}, &User{}))
}

func cleanAgentTables(t *testing.T) {
	require.NoError(t, DB.Exec("DELETE FROM agents").Error)
	require.NoError(t, DB.Exec("DELETE FROM redemptions").Error)
	require.NoError(t, DB.Exec("DELETE FROM agent_allocation_logs").Error)
}

func TestMaskEmail(t *testing.T) {
	cases := map[string]string{
		"abcd@qq.com":    "ab***@qq.com",
		"a@b.com":        "a***@b.com",
		"ab@x.com":       "a***@x.com",
		"abc":            "ab***", // 非法邮箱(无@)整体打码
		"":               "",
		"john.doe@x.com": "jo***@x.com",
	}
	for in, want := range cases {
		assert.Equalf(t, want, MaskEmail(in), "MaskEmail(%q)", in)
	}
}

func TestValidateShopUrl(t *testing.T) {
	assert.NoError(t, ValidateShopUrl(""))                   // 允许清空
	assert.NoError(t, ValidateShopUrl("http://a.com/shop"))  // http
	assert.NoError(t, ValidateShopUrl("https://a.com/shop")) // https
	assert.Error(t, ValidateShopUrl("javascript:alert(1)"))  // 危险协议
	assert.Error(t, ValidateShopUrl("ftp://a.com"))          // 非 http/https
	assert.Error(t, ValidateShopUrl("a.com"))                // 缺协议
	long := "https://a.com/" + string(make([]byte, 512))     // 超长
	assert.Error(t, ValidateShopUrl(long))
}

func TestResolveShopUrlForUser(t *testing.T) {
	mustMigrateAgentTables(t)
	cleanAgentTables(t)

	oldShop, oldTopUp := common.RedemptionShopUrl, common.TopUpLink
	defer func() { common.RedemptionShopUrl, common.TopUpLink = oldShop, oldTopUp }()

	// 建一个已通过、带 shop_url 的代理(user_id=1001)
	code1 := "AGENT001"
	require.NoError(t, DB.Create(&Agent{UserId: 1001, Status: AgentStatusApproved, AgentCode: &code1, ShopUrl: "https://shop.agent/1001"}).Error)
	// 已通过但未填 shop_url 的代理(user_id=1002)
	code2 := "AGENT002"
	require.NoError(t, DB.Create(&Agent{UserId: 1002, Status: AgentStatusApproved, AgentCode: &code2, ShopUrl: ""}).Error)
	// 已禁用的代理(user_id=1003)带 shop_url
	code3 := "AGENT003"
	require.NoError(t, DB.Create(&Agent{UserId: 1003, Status: AgentStatusDisabled, AgentCode: &code3, ShopUrl: "https://shop.agent/1003"}).Error)

	common.RedemptionShopUrl = "https://global.shop"
	common.TopUpLink = "https://topup.link"

	// 1. 归属代理且填了链接 -> 用代理店铺
	assert.Equal(t, "https://shop.agent/1001", ResolveShopUrlForUser(1001))
	// 2. 归属代理但代理未填链接 -> 全局
	assert.Equal(t, "https://global.shop", ResolveShopUrlForUser(1002))
	// 3. 代理被禁用 -> 全局(不用代理店铺)
	assert.Equal(t, "https://global.shop", ResolveShopUrlForUser(1003))
	// 4. 无归属 -> 全局
	assert.Equal(t, "https://global.shop", ResolveShopUrlForUser(0))
	// 5. 全局为空 -> 回退 TopUpLink
	common.RedemptionShopUrl = ""
	assert.Equal(t, "https://topup.link", ResolveShopUrlForUser(0))
	assert.Equal(t, "https://topup.link", ResolveShopUrlForUser(1002))
	// 归属代理有链接时仍优先代理
	assert.Equal(t, "https://shop.agent/1001", ResolveShopUrlForUser(1001))
}

func TestAllocateExistingCodes_Validation(t *testing.T) {
	mustMigrateAgentTables(t)
	cleanAgentTables(t)
	now := common.GetTimestamp()
	// r1 未使用未归属(合格)
	require.NoError(t, DB.Create(&Redemption{Key: "k-valid-1", Status: common.RedemptionCodeStatusEnabled, Quota: 100, AgentId: 0}).Error)
	// r2 已使用(不合格)
	require.NoError(t, DB.Create(&Redemption{Key: "k-used-2", Status: common.RedemptionCodeStatusUsed, Quota: 100, AgentId: 0}).Error)
	// r3 未使用但已归属其他代理(不合格)
	require.NoError(t, DB.Create(&Redemption{Key: "k-other-3", Status: common.RedemptionCodeStatusEnabled, Quota: 100, AgentId: 999}).Error)
	// r4 未使用但已过期(不合格)
	require.NoError(t, DB.Create(&Redemption{Key: "k-exp-4", Status: common.RedemptionCodeStatusEnabled, Quota: 100, AgentId: 0, ExpiredTime: now - 100}).Error)

	var r1, r2, r3, r4 Redemption
	DB.Where("`key` = ?", "k-valid-1").First(&r1)
	DB.Where("`key` = ?", "k-used-2").First(&r2)
	DB.Where("`key` = ?", "k-other-3").First(&r3)
	DB.Where("`key` = ?", "k-exp-4").First(&r4)

	// 含不合格 -> 整批失败并返回不合格 id
	invalid, err := AllocateExistingCodes(2001, 1, []int{r1.Id, r2.Id, r3.Id, r4.Id}, "", "")
	require.NoError(t, err)
	assert.ElementsMatch(t, []int{r2.Id, r3.Id, r4.Id}, invalid)
	// 未提交：r1 仍未归属
	var check1 Redemption
	DB.First(&check1, r1.Id)
	assert.Equal(t, 0, check1.AgentId, "整批失败时不应修改任何码")

	// 全部合格 -> 成功划拨 + 写日志
	invalid, err = AllocateExistingCodes(2001, 1, []int{r1.Id}, "88.5", "test alloc")
	require.NoError(t, err)
	assert.Empty(t, invalid)
	DB.First(&check1, r1.Id)
	assert.Equal(t, 2001, check1.AgentId)
	assert.NotZero(t, check1.AllocatedTime)
	var logCount int64
	DB.Model(&AgentAllocationLog{}).Where("agent_id = ? AND type = ?", 2001, AgentAllocationTypeExisting).Count(&logCount)
	assert.Equal(t, int64(1), logCount)
}

func TestRevokeCodes_Validation(t *testing.T) {
	mustMigrateAgentTables(t)
	cleanAgentTables(t)
	// 属于代理3001、未使用(可收回)
	require.NoError(t, DB.Create(&Redemption{Key: "rk-1", Status: common.RedemptionCodeStatusEnabled, Quota: 50, AgentId: 3001}).Error)
	// 属于代理3001、已使用(不可收回)
	require.NoError(t, DB.Create(&Redemption{Key: "rk-2", Status: common.RedemptionCodeStatusUsed, Quota: 50, AgentId: 3001}).Error)
	// 属于其他代理(不可收回)
	require.NoError(t, DB.Create(&Redemption{Key: "rk-3", Status: common.RedemptionCodeStatusEnabled, Quota: 50, AgentId: 4001}).Error)

	var r1, r2, r3 Redemption
	DB.Where("`key` = ?", "rk-1").First(&r1)
	DB.Where("`key` = ?", "rk-2").First(&r2)
	DB.Where("`key` = ?", "rk-3").First(&r3)

	invalid, err := RevokeCodes(3001, 1, []int{r1.Id, r2.Id, r3.Id}, "revoke")
	require.NoError(t, err)
	assert.ElementsMatch(t, []int{r2.Id, r3.Id}, invalid)

	// 只收回合格的 r1
	invalid, err = RevokeCodes(3001, 1, []int{r1.Id}, "revoke ok")
	require.NoError(t, err)
	assert.Empty(t, invalid)
	var check1 Redemption
	DB.First(&check1, r1.Id)
	assert.Equal(t, 0, check1.AgentId, "收回后 agent_id 应为 0")
	var logCount int64
	DB.Model(&AgentAllocationLog{}).Where("agent_id = ? AND type = ?", 3001, AgentAllocationTypeRevoke).Count(&logCount)
	assert.Equal(t, int64(1), logCount)
}

func TestAllocateNewCodes(t *testing.T) {
	mustMigrateAgentTables(t)
	cleanAgentTables(t)
	keys, err := AllocateNewCodes(5001, 1, 3, 200, "批量码", 0, "100", "new alloc")
	require.NoError(t, err)
	assert.Len(t, keys, 3)
	var cnt int64
	DB.Model(&Redemption{}).Where("agent_id = ?", 5001).Count(&cnt)
	assert.Equal(t, int64(3), cnt)
	// 数量上限
	_, err = AllocateNewCodes(5001, 1, 501, 200, "x", 0, "", "")
	assert.Error(t, err)
	// 额度必须>0
	_, err = AllocateNewCodes(5001, 1, 1, 0, "x", 0, "", "")
	assert.Error(t, err)
}
