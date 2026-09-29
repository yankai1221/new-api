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
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Form,
  Spin,
  Typography,
} from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { Store } from 'lucide-react';
import { API, isAdmin, showError, showSuccess } from '../../helpers';
import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import AgentDashboard from './AgentDashboard';

const { Text, Title } = Typography;

// 代理状态常量（与后端一致）
const STATUS_PENDING = 1;
const STATUS_APPROVED = 2;
const STATUS_REJECTED = 3;
const STATUS_DISABLED = 4;

const AgentCenter = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);

  const [loading, setLoading] = useState(true);
  const [applyEnabled, setApplyEnabled] = useState(true);
  const [agent, setAgent] = useState(null); // 无记录为 null
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formApi, setFormApi] = useState(null);

  const loadApplyStatus = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/agent/apply');
      const { success, message, data } = res.data;
      if (success) {
        setApplyEnabled(!!data.apply_enabled);
        setAgent(data.agent || null);
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 刷新用户信息（sidebar、self 等依赖）
  const refreshSelf = async () => {
    try {
      const res = await API.get('/api/user/self');
      if (res.data?.success) {
        userDispatch({ type: 'login', payload: res.data.data });
        localStorage.setItem('user', JSON.stringify(res.data.data));
      }
    } catch (e) {
      // 忽略
    }
  };

  useEffect(() => {
    loadApplyStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitApply = async (values) => {
    if (!values.contact || !values.apply_reason) {
      showError(t('请填写联系方式和申请说明'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await API.post('/api/agent/apply', {
        contact: values.contact,
        apply_reason: values.apply_reason,
      });
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('申请已提交，请等待管理员审核'));
        setShowApplyForm(false);
        await loadApplyStatus();
        await refreshSelf();
      } else {
        showError(message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const pageWrap = (content) => (
    <div className='w-full max-w-7xl mx-auto relative min-h-screen lg:min-h-0 mt-[60px] px-2'>
      {content}
    </div>
  );

  // 统一的状态横幅：标题独占一行，描述在下一行并留出间距
  const renderStatusBanner = (type, title, desc) => (
    <Banner
      type={type}
      closeIcon={null}
      description={
        <div>
          <div className='font-medium text-sm'>{title}</div>
          <div
            className='text-sm mt-2'
            style={{ color: 'var(--semi-color-text-1)' }}
          >
            {desc}
          </div>
        </div>
      }
    />
  );

  if (loading) {
    return pageWrap(
      <div className='py-20 flex justify-center'>
        <Spin size='large' />
      </div>,
    );
  }

  // 管理员不使用代理中心：提示前往代理管理
  if (isAdmin()) {
    return pageWrap(
      <Card className='!rounded-2xl shadow-sm border-0'>
        <div className='flex items-center mb-4'>
          <Avatar size='small' color='violet' className='mr-3 shadow-md'>
            <Store size={16} />
          </Avatar>
          <Text className='text-lg font-medium'>{t('代理中心')}</Text>
        </div>
        <Banner
          type='info'
          closeIcon={null}
          description={t('管理员请前往「代理管理」进行代理审核与划拨。')}
        />
        <Button
          type='primary'
          theme='solid'
          className='!mt-4'
          onClick={() => navigate('/console/agentmanage')}
        >
          {t('前往代理管理')}
        </Button>
      </Card>,
    );
  }

  // 已通过 -> 代理后台
  if (agent && agent.status === STATUS_APPROVED) {
    return pageWrap(<AgentDashboard t={t} onChanged={refreshSelf} />);
  }

  const header = (
    <div className='flex items-center mb-4'>
      <Avatar size='small' color='violet' className='mr-3 shadow-md'>
        <Store size={16} />
      </Avatar>
      <div>
        <Text className='text-lg font-medium'>{t('代理中心')}</Text>
        <div className='text-xs text-gray-500'>
          {t('成为代理，推广你的专属链接与商城')}
        </div>
      </div>
    </div>
  );

  const applyFormCard = (
    <Card className='!rounded-2xl shadow-sm border-0'>
      {header}
      <Form
        getFormApi={setFormApi}
        onSubmit={submitApply}
        initValues={{
          contact: agent?.contact || '',
          apply_reason: agent?.apply_reason || '',
        }}
      >
        <Form.Input
          field='contact'
          label={t('联系方式')}
          placeholder={t('微信 / QQ / 电话，方便管理员联系你')}
          maxLength={128}
          showClear
        />
        <Form.TextArea
          field='apply_reason'
          label={t('申请说明')}
          placeholder={t('简单说明你的推广渠道、预期规模等')}
          autosize={{ minRows: 3, maxRows: 6 }}
        />
        <div className='mt-4'>
          <Button
            type='primary'
            theme='solid'
            htmlType='submit'
            loading={submitting}
          >
            {t('提交申请')}
          </Button>
          {agent && agent.status === STATUS_REJECTED && (
            <Button
              theme='borderless'
              className='!ml-2'
              onClick={() => setShowApplyForm(false)}
            >
              {t('返回')}
            </Button>
          )}
        </div>
      </Form>
    </Card>
  );

  // 未申请
  if (!agent) {
    if (!applyEnabled) {
      return pageWrap(
        <Card className='!rounded-2xl shadow-sm border-0'>
          {header}
          <Banner
            type='info'
            closeIcon={null}
            description={t('代理申请暂未开放，请稍后再来。')}
          />
        </Card>,
      );
    }
    return pageWrap(applyFormCard);
  }

  // 待审核
  if (agent.status === STATUS_PENDING) {
    return pageWrap(
      <Card className='!rounded-2xl shadow-sm border-0'>
        {header}
        {renderStatusBanner(
          'warning',
          t('申请审核中'),
          t('您的代理申请正在审核中，请耐心等待管理员处理。'),
        )}
      </Card>,
    );
  }

  // 已拒绝
  if (agent.status === STATUS_REJECTED) {
    if (showApplyForm) {
      return pageWrap(applyFormCard);
    }
    return pageWrap(
      <Card className='!rounded-2xl shadow-sm border-0'>
        {header}
        {renderStatusBanner(
          'danger',
          t('申请被拒绝'),
          agent.reject_reason
            ? t('拒绝理由：') + agent.reject_reason
            : t('很抱歉，您的申请未通过。'),
        )}
        {applyEnabled && (
          <Button
            type='primary'
            theme='solid'
            className='!mt-4'
            onClick={() => setShowApplyForm(true)}
          >
            {t('重新申请')}
          </Button>
        )}
      </Card>,
    );
  }

  // 已禁用
  if (agent.status === STATUS_DISABLED) {
    return pageWrap(
      <Card className='!rounded-2xl shadow-sm border-0'>
        {header}
        {renderStatusBanner(
          'danger',
          t('代理资格已被禁用'),
          t('您的代理资格已被管理员禁用，如有疑问请联系管理员。'),
        )}
      </Card>,
    );
  }

  return pageWrap(applyFormCard);
};

export default AgentCenter;
