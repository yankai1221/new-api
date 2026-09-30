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

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  TabPane,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { ShieldCheck, UserPlus } from 'lucide-react';
import {
  API,
  renderQuota,
  showError,
  showSuccess,
  timestamp2string,
} from '../../helpers';
import AgentDetailDrawer from './AgentDetailDrawer';

const { Text } = Typography;
const PAGE_SIZE = 10;

const AGENT_STATUS = {
  1: { text: '待审核', color: 'amber' },
  2: { text: '已通过', color: 'green' },
  3: { text: '已拒绝', color: 'red' },
  4: { text: '已禁用', color: 'grey' },
};

const AgentManage = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState('pending');

  const [pending, setPending] = useState([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingLoading, setPendingLoading] = useState(false);

  const [all, setAll] = useState([]);
  const [allTotal, setAllTotal] = useState(0);
  const [allPage, setAllPage] = useState(1);
  const [allLoading, setAllLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(0); // 0=全部
  const [keyword, setKeyword] = useState('');

  const [approvedAgents, setApprovedAgents] = useState([]);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerAgent, setDrawerAgent] = useState(null);

  const loadPending = async (page = 1) => {
    setPendingLoading(true);
    try {
      const res = await API.get(
        `/api/admin/agents?status=1&p=${page}&page_size=${PAGE_SIZE}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setPending(data.items || []);
        setPendingTotal(data.total || 0);
        setPendingPage(page);
      } else showError(message);
    } catch (e) {
      showError(e.message);
    } finally {
      setPendingLoading(false);
    }
  };

  const loadAll = async (page = 1) => {
    setAllLoading(true);
    try {
      const res = await API.get(
        `/api/admin/agents?status=${statusFilter}&keyword=${encodeURIComponent(keyword)}&p=${page}&page_size=${PAGE_SIZE}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setAll(data.items || []);
        setAllTotal(data.total || 0);
        setAllPage(page);
      } else showError(message);
    } catch (e) {
      showError(e.message);
    } finally {
      setAllLoading(false);
    }
  };

  const loadApprovedAgents = async () => {
    try {
      const res = await API.get('/api/admin/agents?status=2&p=1&page_size=100');
      if (res.data.success) setApprovedAgents(res.data.data.items || []);
    } catch (e) {
      // 忽略
    }
  };

  const refreshAll = () => {
    loadPending(1);
    loadApprovedAgents();
    if (tab === 'all') loadAll(allPage);
  };

  useEffect(() => {
    loadPending(1);
    loadApprovedAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'all') loadAll(1);
    if (tab === 'pending') loadPending(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const approve = (rec) => {
    Modal.confirm({
      title: t('确认通过'),
      content: t('确定通过 {{name}} 的代理申请吗？', { name: rec.username }),
      onOk: async () => {
        try {
          const res = await API.post(`/api/admin/agents/${rec.id}/approve`);
          if (res.data.success) {
            showSuccess(t('已通过'));
            refreshAll();
          } else showError(res.data.message);
        } catch (e) {
          showError(e.message);
        }
      },
    });
  };

  const reject = (rec) => {
    let reason = '';
    Modal.confirm({
      title: t('拒绝申请') + ' - ' + rec.username,
      content: (
        <div className='mt-2'>
          <TextArea
            placeholder={t('请填写拒绝理由（申请人可见）')}
            onChange={(v) => (reason = v)}
            autosize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      ),
      onOk: async () => {
        if (!reason.trim()) {
          showError(t('请填写拒绝理由'));
          return Promise.reject();
        }
        try {
          const res = await API.post(`/api/admin/agents/${rec.id}/reject`, {
            reject_reason: reason.trim(),
          });
          if (res.data.success) {
            showSuccess(t('已拒绝'));
            refreshAll();
          } else showError(res.data.message);
        } catch (e) {
          showError(e.message);
        }
      },
    });
  };

  const disable = (rec) => {
    Modal.confirm({
      title: t('确认禁用'),
      content: t(
        '禁用后该代理推广链接失效、代理中心不可访问。确定禁用 {{name}} 吗？',
        {
          name: rec.username,
        },
      ),
      type: 'warning',
      onOk: async () => {
        try {
          const res = await API.post(`/api/admin/agents/${rec.id}/disable`);
          if (res.data.success) {
            showSuccess(t('已禁用'));
            refreshAll();
          } else showError(res.data.message);
        } catch (e) {
          showError(e.message);
        }
      },
    });
  };

  const enable = (rec) => {
    Modal.confirm({
      title: t('确认恢复'),
      content: t('确定恢复 {{name}} 的代理资格吗？', { name: rec.username }),
      onOk: async () => {
        try {
          const res = await API.post(`/api/admin/agents/${rec.id}/enable`);
          if (res.data.success) {
            showSuccess(t('已恢复'));
            refreshAll();
          } else showError(res.data.message);
        } catch (e) {
          showError(e.message);
        }
      },
    });
  };

  const openDrawer = (rec) => {
    setDrawerAgent(rec);
    setDrawerVisible(true);
  };

  // 直接设为代理
  const createAgent = () => {
    let kw = '';
    let selectedId = null;
    let searchResults = [];
    const modal = Modal.info({
      title: t('直接设为代理'),
      okText: t('确认设为代理'),
      content: (
        <CreateAgentContent
          t={t}
          onPick={(id) => {
            selectedId = id;
          }}
        />
      ),
      onOk: async () => {
        if (!selectedId) {
          showError(t('请先搜索并选择一个用户'));
          return Promise.reject();
        }
        try {
          const res = await API.post('/api/admin/agents/create', {
            user_id: selectedId,
          });
          if (res.data.success) {
            showSuccess(t('已设为代理'));
            refreshAll();
          } else showError(res.data.message);
        } catch (e) {
          showError(e.message);
        }
      },
      width: 520,
    });
  };

  const statusTag = (s) => (
    <Tag color={AGENT_STATUS[s]?.color}>{t(AGENT_STATUS[s]?.text || '')}</Tag>
  );

  const statsCell = (stats) =>
    stats
      ? `${stats.allocated_total}/${stats.allocated_used}/${stats.allocated_unused}`
      : '-';

  const pendingColumns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: t('用户名'), dataIndex: 'username' },
    { title: t('联系方式'), dataIndex: 'contact', render: (v) => v || '-' },
    {
      title: t('申请说明'),
      dataIndex: 'apply_reason',
      render: (v) => v || '-',
    },
    {
      title: t('申请时间'),
      dataIndex: 'created_time',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
    {
      title: t('操作'),
      render: (_, r) => (
        <Space>
          <Button size='small' theme='solid' onClick={() => approve(r)}>
            {t('通过')}
          </Button>
          <Button size='small' type='danger' onClick={() => reject(r)}>
            {t('拒绝')}
          </Button>
        </Space>
      ),
    },
  ];

  const allColumns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: t('用户名'), dataIndex: 'username' },
    { title: t('状态'), render: (_, r) => statusTag(r.status) },
    {
      title: t('代理码'),
      dataIndex: 'agent_code',
      render: (v) => v || '-',
    },
    {
      title: t('商城链接'),
      dataIndex: 'shop_url',
      render: (v) =>
        v ? (
          <a href={v} target='_blank' rel='noopener noreferrer'>
            {v.length > 24 ? v.slice(0, 24) + '…' : v}
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: t('名下用户'),
      render: (_, r) => r.stats?.user_count ?? 0,
    },
    {
      title: t('码(总/已用/未用)'),
      render: (_, r) => statsCell(r.stats),
    },
    {
      title: t('通过时间'),
      dataIndex: 'approved_time',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
    {
      title: t('操作'),
      render: (_, r) => (
        <Space>
          <Button size='small' onClick={() => openDrawer(r)}>
            {t('详情')}
          </Button>
          {r.status === 2 && (
            <Button size='small' type='danger' onClick={() => disable(r)}>
              {t('禁用')}
            </Button>
          )}
          {r.status === 4 && (
            <Button size='small' theme='solid' onClick={() => enable(r)}>
              {t('恢复')}
            </Button>
          )}
          {r.status === 1 && (
            <>
              <Button size='small' theme='solid' onClick={() => approve(r)}>
                {t('通过')}
              </Button>
              <Button size='small' type='danger' onClick={() => reject(r)}>
                {t('拒绝')}
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className='w-full max-w-7xl mx-auto relative min-h-screen lg:min-h-0 mt-[60px] px-2'>
      <Card className='!rounded-2xl shadow-sm border-0'>
        <div className='flex items-center justify-between mb-4 flex-wrap gap-2'>
          <div className='flex items-center'>
            <ShieldCheck size={18} className='mr-2' />
            <Text className='text-lg font-medium'>{t('代理管理')}</Text>
          </div>
          <Button
            icon={<UserPlus size={16} />}
            theme='solid'
            onClick={createAgent}
          >
            {t('直接设为代理')}
          </Button>
        </div>

        <Tabs type='line' activeKey={tab} onChange={setTab}>
          <TabPane
            itemKey='pending'
            tab={
              <span>
                {t('待审核')}
                {pendingTotal > 0 && (
                  <Badge count={pendingTotal} className='!ml-2' type='danger' />
                )}
              </span>
            }
          >
            <Table
              className='py-2'
              loading={pendingLoading}
              dataSource={pending}
              rowKey='id'
              pagination={{
                currentPage: pendingPage,
                pageSize: PAGE_SIZE,
                total: pendingTotal,
                onPageChange: loadPending,
              }}
              empty={<Empty description={t('暂无待审核申请')} />}
              columns={pendingColumns}
            />
          </TabPane>
          <TabPane itemKey='all' tab={t('全部代理')}>
            <div className='flex flex-wrap gap-2 my-2 items-center'>
              <Select
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(v);
                  setTimeout(() => loadAll(1), 0);
                }}
                style={{ width: 140 }}
                optionList={[
                  { label: t('全部状态'), value: 0 },
                  { label: t('待审核'), value: 1 },
                  { label: t('已通过'), value: 2 },
                  { label: t('已拒绝'), value: 3 },
                  { label: t('已禁用'), value: 4 },
                ]}
              />
              <Input
                placeholder={t('搜索用户名')}
                value={keyword}
                onChange={setKeyword}
                onEnterPress={() => loadAll(1)}
                showClear
                style={{ maxWidth: 220 }}
              />
              <Button onClick={() => loadAll(1)}>{t('搜索')}</Button>
            </div>
            <Table
              className='py-2'
              loading={allLoading}
              dataSource={all}
              rowKey='id'
              pagination={{
                currentPage: allPage,
                pageSize: PAGE_SIZE,
                total: allTotal,
                onPageChange: loadAll,
              }}
              empty={<Empty description={t('暂无代理')} />}
              columns={allColumns}
            />
          </TabPane>
        </Tabs>
      </Card>

      <AgentDetailDrawer
        visible={drawerVisible}
        agent={drawerAgent}
        onClose={() => setDrawerVisible(false)}
        onChanged={refreshAll}
        approvedAgents={approvedAgents}
        t={t}
      />
    </div>
  );
};

// 直接设为代理：搜索用户并选择
const CreateAgentContent = ({ t, onPick }) => {
  const [kw, setKw] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(null);

  const search = async () => {
    if (!kw.trim()) return;
    setLoading(true);
    try {
      const res = await API.get(
        `/api/user/search?keyword=${encodeURIComponent(kw.trim())}&p=1&page_size=10`,
      );
      if (res.data.success) setResults(res.data.data.items || []);
      else showError(res.data.message);
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='mt-2'>
      <div className='flex gap-2 mb-2'>
        <Input
          placeholder={t('按用户名 / ID 搜索')}
          value={kw}
          onChange={setKw}
          onEnterPress={search}
          showClear
        />
        <Button onClick={search} loading={loading}>
          {t('搜索')}
        </Button>
      </div>
      <Table
        size='small'
        dataSource={results}
        rowKey='id'
        pagination={false}
        scroll={{ y: 220 }}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: picked ? [picked] : [],
          onChange: (keys) => {
            const id = keys[0];
            setPicked(id);
            onPick(id);
          },
        }}
        empty={<Empty description={t('搜索并选择一个用户')} />}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: t('用户名'), dataIndex: 'username' },
          { title: t('显示名'), dataIndex: 'display_name' },
          {
            title: t('归属代理'),
            dataIndex: 'agent_username',
            render: (v) => v || '-',
          },
        ]}
      />
    </div>
  );
};

export default AgentManage;
