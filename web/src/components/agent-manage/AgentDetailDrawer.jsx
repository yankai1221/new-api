/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useContext, useEffect, useState } from 'react';
import { StatusContext } from '../../context/Status';
import {
  Banner,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  SideSheet,
  Space,
  Spin,
  Table,
  Tabs,
  TabPane,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { Copy, Download } from 'lucide-react';
import {
  API,
  copy,
  downloadTextAsFile,
  getCurrencyConfig,
  renderQuota,
  showError,
  showSuccess,
  timestamp2string,
} from '../../helpers';
import {
  quotaToDisplayAmount,
  displayAmountToQuota,
} from '../../helpers/quota';

const { Text, Title } = Typography;
const PAGE_SIZE = 10;

const FieldLabel = ({ children }) => (
  <div
    className='text-sm mb-1'
    style={{ color: 'var(--semi-color-text-1)', fontWeight: 500 }}
  >
    {children}
  </div>
);

const AGENT_STATUS = {
  1: { text: '待审核', color: 'amber' },
  2: { text: '已通过', color: 'green' },
  3: { text: '已拒绝', color: 'red' },
  4: { text: '已禁用', color: 'grey' },
};

const codeStatusTag = (t, r) => {
  const now = Math.floor(Date.now() / 1000);
  if (r.status === 3) return <Tag color='grey'>{t('已使用')}</Tag>;
  if (r.expired_time !== 0 && r.expired_time < now)
    return <Tag color='orange'>{t('已过期')}</Tag>;
  return <Tag color='green'>{t('未使用')}</Tag>;
};

const isUnusedValid = (r) => {
  const now = Math.floor(Date.now() / 1000);
  return r.status === 1 && (r.expired_time === 0 || r.expired_time > now);
};

const AgentDetailDrawer = ({
  visible,
  agent,
  onClose,
  onChanged,
  approvedAgents,
  t,
}) => {
  const [statusState] = useContext(StatusContext);
  const [tab, setTab] = useState('info');

  // 基本信息
  const [shopUrl, setShopUrl] = useState('');
  const [adminRemark, setAdminRemark] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  // 名下用户
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);

  // 兑换码
  const [codes, setCodes] = useState([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesPage, setCodesPage] = useState(1);
  const [codesTotal, setCodesTotal] = useState(0);
  const [selectedCodeIds, setSelectedCodeIds] = useState([]);

  // 划拨记录
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotal, setLogsTotal] = useState(0);

  // 划拨表单
  const [allocMode, setAllocMode] = useState('new');
  const [allocLoading, setAllocLoading] = useState(false);
  // 模式A
  const [aAmount, setAAmount] = useState(
    Number(quotaToDisplayAmount(100000).toFixed(6)),
  );
  const [aQuota, setAQuota] = useState(100000);
  const [aCount, setACount] = useState(1);
  const [aName, setAName] = useState('');
  const [aExpired, setAExpired] = useState(null);
  const [aPaid, setAPaid] = useState('');
  const [aRemark, setARemark] = useState('');
  // 模式B
  const [poolCodes, setPoolCodes] = useState([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolKeyword, setPoolKeyword] = useState('');
  const [poolSelected, setPoolSelected] = useState([]);
  const [bPaid, setBPaid] = useState('');
  const [bRemark, setBRemark] = useState('');

  const agentId = agent?.id;
  const agentUserId = agent?.user_id;

  const loadUsers = async (page = 1) => {
    if (!agentId) return;
    setUsersLoading(true);
    try {
      const res = await API.get(
        `/api/admin/agents/${agentId}/users?p=${page}&page_size=${PAGE_SIZE}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setUsers(data.items || []);
        setUsersTotal(data.total || 0);
        setUsersPage(page);
      } else showError(message);
    } catch (e) {
      showError(e.message);
    } finally {
      setUsersLoading(false);
    }
  };

  const loadCodes = async (page = 1) => {
    if (!agentUserId) return;
    setCodesLoading(true);
    setSelectedCodeIds([]);
    try {
      const res = await API.get(
        `/api/redemption/?agent_id=${agentUserId}&p=${page}&page_size=${PAGE_SIZE}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setCodes(data.items || []);
        setCodesTotal(data.total || 0);
        setCodesPage(page);
      } else showError(message);
    } catch (e) {
      showError(e.message);
    } finally {
      setCodesLoading(false);
    }
  };

  const loadLogs = async (page = 1) => {
    if (!agentId) return;
    setLogsLoading(true);
    try {
      const res = await API.get(
        `/api/admin/agents/${agentId}/allocation_logs?p=${page}&page_size=${PAGE_SIZE}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setLogs(data.items || []);
        setLogsTotal(data.total || 0);
        setLogsPage(page);
      } else showError(message);
    } catch (e) {
      showError(e.message);
    } finally {
      setLogsLoading(false);
    }
  };

  const loadPool = async (keyword = '') => {
    setPoolLoading(true);
    setPoolSelected([]);
    try {
      const path = keyword
        ? `/api/redemption/search?keyword=${encodeURIComponent(keyword)}&agent_id=0&p=1&page_size=100`
        : `/api/redemption/?agent_id=0&p=1&page_size=100`;
      const res = await API.get(path);
      const { success, message, data } = res.data;
      if (success) {
        setPoolCodes((data.items || []).filter(isUnusedValid));
      } else showError(message);
    } catch (e) {
      showError(e.message);
    } finally {
      setPoolLoading(false);
    }
  };

  // 初始化 / 切换代理
  useEffect(() => {
    if (visible && agent) {
      setTab('info');
      setShopUrl(agent.shop_url || '');
      setAdminRemark(agent.admin_remark || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, agent?.id]);

  useEffect(() => {
    if (!visible) return;
    if (tab === 'users') loadUsers(1);
    if (tab === 'codes') loadCodes(1);
    if (tab === 'logs') loadLogs(1);
    if (tab === 'allocate' && allocMode === 'existing') loadPool('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, visible]);

  const saveInfo = async () => {
    const url = (shopUrl || '').trim();
    if (url && !/^https?:\/\//i.test(url)) {
      showError(t('商城链接必须以 http:// 或 https:// 开头'));
      return;
    }
    setSavingInfo(true);
    try {
      const res = await API.put(`/api/admin/agents/${agentId}`, {
        shop_url: url,
        admin_remark: adminRemark,
      });
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('保存成功'));
        onChanged && onChanged();
      } else showError(message);
    } catch (e) {
      showError(e.message);
    } finally {
      setSavingInfo(false);
    }
  };

  const reassign = (user) => {
    let target = user.agent_id || 0;
    Modal.confirm({
      title: t('修改归属') + ' - ' + user.username,
      content: (
        <div className='mt-2'>
          <Select
            defaultValue={target}
            style={{ width: '100%' }}
            onChange={(v) => (target = v)}
            optionList={[
              { label: t('无归属'), value: 0 },
              ...approvedAgents.map((a) => ({
                label: a.username,
                value: a.user_id,
              })),
            ]}
          />
        </div>
      ),
      onOk: async () => {
        try {
          const res = await API.put(`/api/admin/users/${user.id}/agent`, {
            agent_id: target,
          });
          if (res.data.success) {
            showSuccess(t('修改成功'));
            loadUsers(usersPage);
            onChanged && onChanged();
          } else showError(res.data.message);
        } catch (e) {
          showError(e.message);
        }
      },
    });
  };

  const revokeSelected = () => {
    if (selectedCodeIds.length === 0) {
      showError(t('请先选择要收回的未使用兑换码'));
      return;
    }
    Modal.confirm({
      title: t('确认收回'),
      content: t('确定收回选中的 {{count}} 个未使用兑换码吗？', {
        count: selectedCodeIds.length,
      }),
      onOk: async () => {
        try {
          const res = await API.post(`/api/admin/agents/${agentId}/revoke`, {
            redemption_ids: selectedCodeIds,
            remark: 'admin revoke',
          });
          if (res.data.success) {
            showSuccess(t('收回成功'));
            loadCodes(codesPage);
            onChanged && onChanged();
          } else {
            const inv = res.data.data?.invalid_ids;
            showError(
              res.data.message + (inv ? ' (' + inv.join(', ') + ')' : ''),
            );
          }
        } catch (e) {
          showError(e.message);
        }
      },
    });
  };

  const showGeneratedCodes = (keys) => {
    const text = keys.join('\n');
    Modal.info({
      title: t('生成成功，共 {{count}} 个', { count: keys.length }),
      content: (
        <div>
          <TextArea
            value={text}
            readOnly
            autosize={{ minRows: 4, maxRows: 12 }}
          />
          <Space className='mt-3'>
            <Button
              icon={<Copy size={14} />}
              onClick={async () => {
                (await copy(text))
                  ? showSuccess(t('已复制到剪贴板'))
                  : showError(t('复制失败，请手动复制'));
              }}
            >
              {t('复制全部')}
            </Button>
            <Button
              icon={<Download size={14} />}
              onClick={() =>
                downloadTextAsFile(text, `agent-${agentUserId}-codes.txt`)
              }
            >
              {t('下载 txt')}
            </Button>
          </Space>
        </div>
      ),
      width: 520,
    });
  };

  const submitAllocateNew = async () => {
    if (!aName.trim()) {
      showError(t('请填写兑换码名称'));
      return;
    }
    const quota = displayAmountToQuota(aAmount);
    if (quota <= 0) {
      showError(t('请输入金额'));
      return;
    }
    if (!aCount || aCount <= 0) {
      showError(t('请输入生成数量'));
      return;
    }
    setAllocLoading(true);
    try {
      const res = await API.post(`/api/admin/agents/${agentId}/allocate`, {
        mode: 'new',
        count: parseInt(aCount, 10),
        quota,
        name: aName.trim(),
        expired_time: aExpired ? Math.floor(aExpired.getTime() / 1000) : 0,
        paid_amount: aPaid.trim(),
        remark: aRemark,
      });
      if (res.data.success) {
        showSuccess(t('划拨成功'));
        showGeneratedCodes(res.data.data.keys || []);
        onChanged && onChanged();
      } else showError(res.data.message);
    } catch (e) {
      showError(e.message);
    } finally {
      setAllocLoading(false);
    }
  };

  const submitAllocateExisting = async () => {
    if (poolSelected.length === 0) {
      showError(t('请选择要划拨的兑换码'));
      return;
    }
    setAllocLoading(true);
    try {
      const res = await API.post(`/api/admin/agents/${agentId}/allocate`, {
        mode: 'existing',
        redemption_ids: poolSelected,
        paid_amount: bPaid.trim(),
        remark: bRemark,
      });
      if (res.data.success) {
        showSuccess(t('划拨成功'));
        setPoolSelected([]);
        loadPool(poolKeyword);
        onChanged && onChanged();
      } else {
        const inv = res.data.data?.invalid_ids;
        showError(res.data.message + (inv ? ' (' + inv.join(', ') + ')' : ''));
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setAllocLoading(false);
    }
  };

  if (!agent) return null;

  // 推广链接域名必须使用系统设置中的「服务器地址」，不依赖请求 Host / localhost
  const serverAddress = (statusState?.status?.server_address || '').replace(
    /\/+$/,
    '',
  );
  const promotionLink =
    agent.agent_code && serverAddress
      ? `${serverAddress}/register?agent=${agent.agent_code}`
      : '';

  const infoTab = (
    <div className='py-2'>
      <Card className='!rounded-xl mb-3'>
        <div className='grid grid-cols-2 gap-2 text-sm'>
          <div>
            {t('用户名')}：{agent.username}
          </div>
          <div>
            {t('状态')}：
            <Tag color={AGENT_STATUS[agent.status]?.color}>
              {t(AGENT_STATUS[agent.status]?.text || '')}
            </Tag>
          </div>
          <div>
            {t('代理码')}：{agent.agent_code || '-'}
          </div>
          <div>
            {t('联系方式')}：{agent.contact || '-'}
          </div>
        </div>
        {promotionLink ? (
          <div className='flex gap-2 mt-3 items-center'>
            <Input readOnly value={promotionLink} className='flex-1' />
            <Button
              icon={<Copy size={14} />}
              onClick={async () =>
                (await copy(promotionLink))
                  ? showSuccess(t('已复制到剪贴板'))
                  : showError(t('复制失败，请手动复制'))
              }
            >
              {t('复制链接')}
            </Button>
          </div>
        ) : (
          agent.agent_code && (
            <Banner
              type='warning'
              closeIcon={null}
              className='!mt-3'
              description={t(
                '系统尚未配置「服务器地址」，暂无法生成推广链接，请先在系统设置中填写服务器地址。',
              )}
            />
          )
        )}
      </Card>
      <Card className='!rounded-xl'>
        <FieldLabel>{t('商城链接')}</FieldLabel>
        <Input
          value={shopUrl}
          onChange={setShopUrl}
          placeholder='https://...'
          showClear
          className='!mb-3'
        />
        <FieldLabel>{t('管理员备注')}</FieldLabel>
        <TextArea
          value={adminRemark}
          onChange={setAdminRemark}
          autosize={{ minRows: 2, maxRows: 5 }}
          className='!mb-3'
        />
        <Button theme='solid' loading={savingInfo} onClick={saveInfo}>
          {t('保存')}
        </Button>
      </Card>
    </div>
  );

  const usersTab = (
    <Table
      className='py-2'
      loading={usersLoading}
      dataSource={users}
      rowKey='id'
      pagination={{
        currentPage: usersPage,
        pageSize: PAGE_SIZE,
        total: usersTotal,
        onPageChange: loadUsers,
      }}
      empty={<Empty description={t('暂无名下用户')} />}
      columns={[
        { title: 'ID', dataIndex: 'id', width: 70 },
        { title: t('用户名'), dataIndex: 'username' },
        { title: t('显示名'), dataIndex: 'display_name' },
        { title: t('邮箱'), dataIndex: 'email', render: (v) => v || '-' },
        {
          title: t('当前余额'),
          dataIndex: 'quota',
          render: (v) => renderQuota(v || 0),
        },
        {
          title: t('累计消耗'),
          dataIndex: 'used_quota',
          render: (v) => renderQuota(v || 0),
        },
        {
          title: t('操作'),
          render: (_, r) => (
            <Button theme='borderless' size='small' onClick={() => reassign(r)}>
              {t('修改归属')}
            </Button>
          ),
        },
      ]}
    />
  );

  const codesTab = (
    <div className='py-2'>
      <div className='flex justify-between items-center mb-2'>
        <Text type='tertiary' className='text-xs'>
          {t('勾选未使用的码可批量收回')}
        </Text>
        <Button
          type='danger'
          theme='light'
          disabled={selectedCodeIds.length === 0}
          onClick={revokeSelected}
        >
          {t('收回选中')}（{selectedCodeIds.length}）
        </Button>
      </div>
      <Table
        loading={codesLoading}
        dataSource={codes}
        rowKey='id'
        rowSelection={{
          selectedRowKeys: selectedCodeIds,
          onChange: (keys) => setSelectedCodeIds(keys),
          getCheckboxProps: (record) => ({ disabled: !isUnusedValid(record) }),
        }}
        pagination={{
          currentPage: codesPage,
          pageSize: PAGE_SIZE,
          total: codesTotal,
          onPageChange: loadCodes,
        }}
        empty={<Empty description={t('暂无兑换码')} />}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          {
            title: t('兑换码'),
            dataIndex: 'key',
            render: (v) => <Text copyable>{v}</Text>,
          },
          {
            title: t('额度'),
            dataIndex: 'quota',
            render: (v) => renderQuota(v || 0),
          },
          { title: t('状态'), render: (_, r) => codeStatusTag(t, r) },
          {
            title: t('过期时间'),
            dataIndex: 'expired_time',
            render: (v) => (v ? timestamp2string(v) : t('永不过期')),
          },
        ]}
      />
    </div>
  );

  const allocTypeText = { 1: '新码划拨', 2: '划拨已有', 3: '收回' };
  const logsTab = (
    <Table
      className='py-2'
      loading={logsLoading}
      dataSource={logs}
      rowKey='id'
      pagination={{
        currentPage: logsPage,
        pageSize: PAGE_SIZE,
        total: logsTotal,
        onPageChange: loadLogs,
      }}
      empty={<Empty description={t('暂无划拨记录')} />}
      columns={[
        {
          title: t('时间'),
          dataIndex: 'created_time',
          render: (v) => (v ? timestamp2string(v) : '-'),
        },
        {
          title: t('类型'),
          dataIndex: 'type',
          render: (v) => t(allocTypeText[v] || '-'),
        },
        { title: t('数量'), dataIndex: 'code_count' },
        {
          title: t('单码额度'),
          dataIndex: 'quota_per_code',
          render: (v) => (v ? renderQuota(v) : '-'),
        },
        {
          title: t('总额度'),
          dataIndex: 'total_quota',
          render: (v) => renderQuota(v || 0),
        },
        {
          title: t('实付金额'),
          dataIndex: 'paid_amount',
          render: (v) => v || '-',
        },
        { title: t('备注'), dataIndex: 'remark', render: (v) => v || '-' },
        { title: t('操作人'), dataIndex: 'operator_id' },
      ]}
    />
  );

  const allocateTab = (
    <div className='py-2'>
      <Select
        value={allocMode}
        onChange={(v) => {
          setAllocMode(v);
          if (v === 'existing') loadPool('');
        }}
        style={{ width: 220 }}
        className='!mb-3'
        optionList={[
          { label: t('模式A：生成新码'), value: 'new' },
          { label: t('模式B：划拨已有码'), value: 'existing' },
        ]}
      />
      {allocMode === 'new' ? (
        <Card className='!rounded-xl'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <div>
              <FieldLabel>{t('金额')}</FieldLabel>
              <InputNumber
                prefix={getCurrencyConfig().symbol}
                value={aAmount}
                precision={6}
                min={0}
                step={0.000001}
                style={{ width: '100%' }}
                onChange={(val) => {
                  const amount = val === '' || val == null ? 0 : val;
                  setAAmount(amount);
                  setAQuota(displayAmountToQuota(amount));
                }}
              />
              <Text type='tertiary' className='text-xs'>
                {t('对应额度')}: {aQuota}
              </Text>
            </div>
            <div>
              <FieldLabel>{t('生成数量')}</FieldLabel>
              <InputNumber
                value={aCount}
                min={1}
                max={500}
                style={{ width: '100%' }}
                onChange={setACount}
              />
            </div>
            <div>
              <FieldLabel>{t('名称')}</FieldLabel>
              <Input value={aName} onChange={setAName} showClear />
            </div>
            <div>
              <FieldLabel>{t('过期时间')}</FieldLabel>
              <DatePicker
                type='dateTime'
                value={aExpired}
                onChange={setAExpired}
                placeholder={t('可选，留空为永久')}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <FieldLabel>{t('实付金额')}</FieldLabel>
              <Input
                value={aPaid}
                onChange={setAPaid}
                placeholder={t('代理实付，可空')}
                showClear
              />
            </div>
            <div>
              <FieldLabel>{t('备注')}</FieldLabel>
              <Input value={aRemark} onChange={setARemark} showClear />
            </div>
          </div>
          <Button
            theme='solid'
            type='primary'
            className='!mt-4'
            loading={allocLoading}
            onClick={submitAllocateNew}
          >
            {t('生成并划拨')}
          </Button>
        </Card>
      ) : (
        <Card className='!rounded-xl'>
          <div className='flex gap-2 mb-3'>
            <Input
              placeholder={t('按名称/ID搜索未归属的码')}
              value={poolKeyword}
              onChange={setPoolKeyword}
              onEnterPress={() => loadPool(poolKeyword)}
              showClear
              style={{ maxWidth: 260 }}
            />
            <Button onClick={() => loadPool(poolKeyword)}>{t('搜索')}</Button>
          </div>
          <Table
            loading={poolLoading}
            dataSource={poolCodes}
            rowKey='id'
            rowSelection={{
              selectedRowKeys: poolSelected,
              onChange: (keys) => setPoolSelected(keys),
            }}
            pagination={false}
            scroll={{ y: 260 }}
            empty={<Empty description={t('暂无可划拨的码')} />}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 60 },
              { title: t('名称'), dataIndex: 'name', render: (v) => v || '-' },
              {
                title: t('额度'),
                dataIndex: 'quota',
                render: (v) => renderQuota(v || 0),
              },
              {
                title: t('过期时间'),
                dataIndex: 'expired_time',
                render: (v) => (v ? timestamp2string(v) : t('永不过期')),
              },
            ]}
          />
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3'>
            <div>
              <FieldLabel>{t('实付金额')}</FieldLabel>
              <Input value={bPaid} onChange={setBPaid} showClear />
            </div>
            <div>
              <FieldLabel>{t('备注')}</FieldLabel>
              <Input value={bRemark} onChange={setBRemark} showClear />
            </div>
          </div>
          <Button
            theme='solid'
            type='primary'
            className='!mt-4'
            loading={allocLoading}
            onClick={submitAllocateExisting}
          >
            {t('划拨选中')}（{poolSelected.length}）
          </Button>
        </Card>
      )}
    </div>
  );

  return (
    <SideSheet
      title={
        <Space>
          <Title heading={5} className='m-0'>
            {t('代理详情')} - {agent.username}
          </Title>
        </Space>
      }
      visible={visible}
      onCancel={onClose}
      width={720}
    >
      <Tabs type='line' activeKey={tab} onChange={setTab}>
        <TabPane tab={t('基本信息')} itemKey='info'>
          {infoTab}
        </TabPane>
        <TabPane tab={t('名下用户')} itemKey='users'>
          {usersTab}
        </TabPane>
        <TabPane tab={t('兑换码')} itemKey='codes'>
          {codesTab}
        </TabPane>
        <TabPane tab={t('划拨记录')} itemKey='logs'>
          {logsTab}
        </TabPane>
        <TabPane tab={t('划拨兑换码')} itemKey='allocate'>
          {allocateTab}
        </TabPane>
      </Tabs>
    </SideSheet>
  );
};

export default AgentDetailDrawer;
