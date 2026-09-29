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
import {
  Banner,
  Button,
  Card,
  Empty,
  Form,
  Input,
  SideSheet,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  TabPane,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Copy,
  Download,
  Store,
  Users,
  Ticket,
  Wallet,
  TrendingUp,
} from 'lucide-react';
import {
  API,
  copy,
  renderQuota,
  showError,
  showSuccess,
  timestamp2string,
} from '../../helpers';

const { Text, Title, Paragraph } = Typography;

const PAGE_SIZE = 10;

// 兑换码状态展示
const redemptionStatusTag = (t, r) => {
  const now = Math.floor(Date.now() / 1000);
  if (r.status === 3) {
    return <Tag color='grey'>{t('已使用')}</Tag>;
  }
  if (r.expired_time !== 0 && r.expired_time < now) {
    return <Tag color='orange'>{t('已过期')}</Tag>;
  }
  return <Tag color='green'>{t('未使用')}</Tag>;
};

const StatCard = ({ icon, label, value }) => (
  <Card className='!rounded-xl' bodyStyle={{ padding: '16px' }}>
    <div className='flex items-center gap-3'>
      <div
        className='flex items-center justify-center rounded-lg shrink-0'
        style={{
          width: 40,
          height: 40,
          background: 'var(--semi-color-fill-0)',
        }}
      >
        {icon}
      </div>
      <div>
        <div className='text-lg font-semibold'>{value}</div>
        <Text type='tertiary' className='text-xs'>
          {label}
        </Text>
      </div>
    </div>
  </Card>
);

const AgentDashboard = ({ t, onChanged }) => {
  const [activeTab, setActiveTab] = useState('overview');

  // 概览
  const [selfLoading, setSelfLoading] = useState(true);
  const [self, setSelf] = useState(null);
  const [shopUrlInput, setShopUrlInput] = useState('');
  const [savingShop, setSavingShop] = useState(false);

  // 我的用户
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersKeyword, setUsersKeyword] = useState('');
  const [drawer, setDrawer] = useState({
    visible: false,
    user: null,
    loading: false,
    records: [],
  });

  // 我的兑换码
  const [reds, setReds] = useState([]);
  const [redsLoading, setRedsLoading] = useState(false);
  const [redsPage, setRedsPage] = useState(1);
  const [redsTotal, setRedsTotal] = useState(0);
  const [redStatus, setRedStatus] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadSelf = async () => {
    setSelfLoading(true);
    try {
      const res = await API.get('/api/agent/self');
      const { success, message, data } = res.data;
      if (success) {
        setSelf(data);
        setShopUrlInput(data.shop_url || '');
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setSelfLoading(false);
    }
  };

  const loadUsers = async (page = 1, keyword = '') => {
    setUsersLoading(true);
    try {
      const res = await API.get(
        `/api/agent/users?p=${page}&page_size=${PAGE_SIZE}&keyword=${encodeURIComponent(keyword)}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setUsers(data.items || []);
        setUsersTotal(data.total || 0);
        setUsersPage(page);
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setUsersLoading(false);
    }
  };

  const loadReds = async (page = 1, status = '') => {
    setRedsLoading(true);
    try {
      const res = await API.get(
        `/api/agent/redemptions?p=${page}&page_size=${PAGE_SIZE}&status=${status}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        setReds(data.items || []);
        setRedsTotal(data.total || 0);
        setRedsPage(page);
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setRedsLoading(false);
    }
  };

  useEffect(() => {
    loadSelf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'users') loadUsers(1, usersKeyword);
    if (activeTab === 'redemptions') loadReds(1, redStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const saveShopUrl = async () => {
    const url = (shopUrlInput || '').trim();
    if (url && !/^https?:\/\//i.test(url)) {
      showError(t('商城链接必须以 http:// 或 https:// 开头'));
      return;
    }
    setSavingShop(true);
    try {
      const res = await API.put('/api/agent/self', { shop_url: url });
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('保存成功'));
        await loadSelf();
        onChanged && onChanged();
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setSavingShop(false);
    }
  };

  const doCopy = async (text) => {
    if (!text) return;
    const ok = await copy(text);
    if (ok) {
      showSuccess(t('已复制到剪贴板'));
    } else {
      showError(t('复制失败，请手动复制'));
    }
  };

  const openUserRecords = async (user) => {
    setDrawer({ visible: true, user, loading: true, records: [] });
    try {
      const res = await API.get(`/api/agent/users/${user.id}/redemptions`);
      const { success, message, data } = res.data;
      if (success) {
        setDrawer({ visible: true, user, loading: false, records: data || [] });
      } else {
        showError(message);
        setDrawer({ visible: true, user, loading: false, records: [] });
      }
    } catch (e) {
      showError(e.message);
      setDrawer({ visible: true, user, loading: false, records: [] });
    }
  };

  // 导出：通过 API 实例请求（带鉴权），前端生成 txt 下载
  const exportUnused = async () => {
    setExporting(true);
    try {
      const res = await API.get('/api/agent/redemptions/export');
      const content = typeof res.data === 'string' ? res.data : '';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = 'redemption_codes.txt';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showSuccess(t('导出成功'));
    } catch (e) {
      showError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const stats = self?.stats || {};

  const overviewTab = (
    <div className='py-2'>
      {selfLoading ? (
        <div className='py-10 flex justify-center'>
          <Spin size='large' />
        </div>
      ) : (
        <Space vertical style={{ width: '100%' }} spacing='medium'>
          {/* 统计卡片 */}
          <div className='grid grid-cols-2 md:grid-cols-3 gap-3 w-full'>
            <StatCard
              icon={<Users size={20} />}
              label={t('名下用户')}
              value={stats.user_count || 0}
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              label={t('本月新增')}
              value={stats.month_new_user_count || 0}
            />
            <StatCard
              icon={<Wallet size={20} />}
              label={t('名下累计兑换')}
              value={renderQuota(stats.downstream_redeemed_quota || 0)}
            />
            <StatCard
              icon={<Ticket size={20} />}
              label={t('其中本代理码')}
              value={renderQuota(stats.my_code_redeemed_quota || 0)}
            />
            <StatCard
              icon={<Ticket size={20} />}
              label={t('划拨码 / 已用 / 未用')}
              value={`${stats.allocated_total || 0} / ${stats.allocated_used || 0} / ${stats.allocated_unused || 0}`}
            />
          </div>

          {/* 推广链接 */}
          <Card className='!rounded-xl w-full' title={t('专属推广链接')}>
            <div className='flex flex-col sm:flex-row gap-2 sm:items-center'>
              <Input
                readOnly
                value={self?.promotion_link || ''}
                prefix={<Store size={16} />}
                className='flex-1'
              />
              <Button
                icon={<Copy size={16} />}
                theme='solid'
                onClick={() => doCopy(self?.promotion_link)}
                disabled={!self?.promotion_link}
              >
                {t('复制链接')}
              </Button>
            </div>
            <Text type='tertiary' className='text-xs'>
              {t('代理码：')}
              {self?.agent_code || '-'}
            </Text>
          </Card>

          {/* 商城链接编辑 */}
          <Card className='!rounded-xl w-full' title={t('我的商城链接')}>
            <Banner
              type='info'
              closeIcon={null}
              className='!mb-3'
              description={t(
                '填写后，你名下用户在钱包页的"购买兑换码"入口将跳转到你的商城；留空则使用平台默认链接。',
              )}
            />
            <div className='flex flex-col sm:flex-row gap-2 sm:items-center'>
              <Input
                value={shopUrlInput}
                onChange={setShopUrlInput}
                placeholder='https://...'
                showClear
                className='flex-1'
              />
              <Button
                theme='solid'
                type='primary'
                loading={savingShop}
                onClick={saveShopUrl}
              >
                {t('保存')}
              </Button>
            </div>
          </Card>
        </Space>
      )}
    </div>
  );

  const userColumns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: t('用户名'), dataIndex: 'username' },
    { title: t('显示名'), dataIndex: 'display_name' },
    { title: t('邮箱'), dataIndex: 'email', render: (v) => v || '-' },
    {
      title: t('注册时间'),
      dataIndex: 'created_time',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
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
    { title: t('请求次数'), dataIndex: 'request_count' },
    {
      title: t('操作'),
      render: (_, record) => (
        <Button
          theme='borderless'
          size='small'
          onClick={() => openUserRecords(record)}
        >
          {t('兑换记录')}
        </Button>
      ),
    },
  ];

  const usersTab = (
    <div className='py-2'>
      <div className='flex gap-2 mb-3'>
        <Input
          placeholder={t('搜索用户名 / ID')}
          value={usersKeyword}
          onChange={setUsersKeyword}
          onEnterPress={() => loadUsers(1, usersKeyword)}
          showClear
          style={{ maxWidth: 260 }}
        />
        <Button onClick={() => loadUsers(1, usersKeyword)}>{t('搜索')}</Button>
      </div>
      <Table
        columns={userColumns}
        dataSource={users}
        loading={usersLoading}
        rowKey='id'
        pagination={{
          currentPage: usersPage,
          pageSize: PAGE_SIZE,
          total: usersTotal,
          onPageChange: (p) => loadUsers(p, usersKeyword),
        }}
        empty={<Empty description={t('暂无名下用户')} />}
      />
    </div>
  );

  const redColumns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: t('兑换码'),
      dataIndex: 'key',
      render: (v) => <Text copyable>{v}</Text>,
    },
    { title: t('名称'), dataIndex: 'name', render: (v) => v || '-' },
    {
      title: t('额度'),
      dataIndex: 'quota',
      render: (v) => renderQuota(v || 0),
    },
    {
      title: t('状态'),
      render: (_, r) => redemptionStatusTag(t, r),
    },
    {
      title: t('过期时间'),
      dataIndex: 'expired_time',
      render: (v) => (v ? timestamp2string(v) : t('永不过期')),
    },
  ];

  const redemptionsTab = (
    <div className='py-2'>
      <div className='flex flex-wrap gap-2 mb-3 items-center'>
        <Select
          value={redStatus}
          onChange={(v) => {
            setRedStatus(v);
            loadReds(1, v);
          }}
          style={{ width: 160 }}
          optionList={[
            { label: t('全部'), value: '' },
            { label: t('未使用'), value: 'unused' },
            { label: t('已使用'), value: 'used' },
            { label: t('已过期'), value: 'expired' },
          ]}
        />
        <Button
          icon={<Download size={16} />}
          theme='solid'
          loading={exporting}
          onClick={exportUnused}
        >
          {t('导出未使用码')}
        </Button>
      </div>
      <Table
        columns={redColumns}
        dataSource={reds}
        loading={redsLoading}
        rowKey='id'
        pagination={{
          currentPage: redsPage,
          pageSize: PAGE_SIZE,
          total: redsTotal,
          onPageChange: (p) => loadReds(p, redStatus),
        }}
        empty={<Empty description={t('暂无兑换码')} />}
      />
    </div>
  );

  const helpTab = (
    <div className='py-2'>
      <Card className='!rounded-xl'>
        <Title heading={6}>{t('使用说明')}</Title>
        <Paragraph spacing='normal' className='!mt-2'>
          <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
            <li>
              {t(
                '复制"专属推广链接"分享给用户，通过该链接注册的用户会归属到你名下。',
              )}
            </li>
            <li>
              {t(
                '在"我的商城链接"填写你的店铺地址，你名下用户购买兑换码时会跳转到你的商城。',
              )}
            </li>
            <li>
              {t(
                '向管理员采购兑换码，管理员划拨后会出现在"我的兑换码"中，你可在自己的商城加价出售。',
              )}
            </li>
            <li>
              {t(
                '在"我的用户"可查看名下用户及其兑换记录（他人来源的兑换码不显示明文）。',
              )}
            </li>
            <li>
              {t('系统不做自动分佣，代理收益来自你自行采购与销售的差价。')}
            </li>
          </ol>
        </Paragraph>
      </Card>
    </div>
  );

  const recordColumns = [
    {
      title: t('时间'),
      dataIndex: 'redeemed_time',
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
    {
      title: t('额度'),
      dataIndex: 'quota',
      render: (v) => renderQuota(v || 0),
    },
    {
      title: t('来源'),
      dataIndex: 'is_mine',
      render: (v) =>
        v ? (
          <Tag color='green'>{t('本代理码')}</Tag>
        ) : (
          <Tag color='grey'>{t('其他来源')}</Tag>
        ),
    },
    {
      title: t('兑换码'),
      dataIndex: 'key',
      render: (v) => (v ? <Text copyable>{v}</Text> : '—'),
    },
  ];

  return (
    <Card className='!rounded-2xl shadow-sm border-0'>
      <div className='flex items-center mb-4'>
        <Store size={18} className='mr-2' />
        <Text className='text-lg font-medium'>{t('代理中心')}</Text>
      </div>
      <Tabs type='line' activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab={t('概览')} itemKey='overview'>
          {overviewTab}
        </TabPane>
        <TabPane tab={t('我的用户')} itemKey='users'>
          {usersTab}
        </TabPane>
        <TabPane tab={t('我的兑换码')} itemKey='redemptions'>
          {redemptionsTab}
        </TabPane>
        <TabPane tab={t('说明')} itemKey='help'>
          {helpTab}
        </TabPane>
      </Tabs>

      <SideSheet
        title={
          drawer.user
            ? t('兑换记录') + ' - ' + drawer.user.username
            : t('兑换记录')
        }
        visible={drawer.visible}
        onCancel={() => setDrawer({ ...drawer, visible: false })}
        width={520}
      >
        {drawer.loading ? (
          <div className='py-10 flex justify-center'>
            <Spin />
          </div>
        ) : (
          <Table
            columns={recordColumns}
            dataSource={drawer.records}
            rowKey='id'
            pagination={false}
            empty={<Empty description={t('该用户暂无兑换记录')} />}
          />
        )}
      </SideSheet>
    </Card>
  );
};

export default AgentDashboard;
