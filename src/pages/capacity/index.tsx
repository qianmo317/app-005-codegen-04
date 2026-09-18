import React, { useMemo, useState } from 'react';
import {
  Row,
  Col,
  Card,
  Table,
  Tag,
  Button,
  Space,
  Select,
  DatePicker,
  TimePicker,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Avatar,
  Alert,
  Popconfirm,
  Empty,
  Tabs
} from 'antd';
import {
  ClockCircleOutlined,
  UserOutlined,
  PlusOutlined,
  SwapOutlined,
  BellOutlined,
  DeleteOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { useSelector, useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import type { RootState } from '../../store';
import {
  upsertCapacityRule,
  addLeaveRequest,
  deleteLeaveRequest,
  addRescheduleRecord,
  updateRescheduleRecord,
  updateAppointment
} from '../../store';
import type { Appointment, CapacityRule, LeaveRequest, RescheduleRecord } from '../../types';
import {
  BUSINESS_HOURS,
  DEFAULT_MAX_CUSTOMERS,
  DEFAULT_REQUIRED_STAFF,
  getRuleCapacity,
  getSlotCapacity,
  getSlotAppointments,
  computeDaySlots,
  getLeaveAffectedAppointments,
  type SlotStatus
} from '../../utils/capacity';
import { formatTime, generateId, getStatusColor, getStatusText } from '../../utils/format';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pad = (n: number) => String(n).padStart(2, '0');

const CapacityManage: React.FC = () => {
  const dispatch = useDispatch();
  const state = useSelector((s: RootState) => s.app);
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [ruleDayOfWeek, setRuleDayOfWeek] = useState(dayjs().day());
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveForm] = Form.useForm();
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    appointment: Appointment;
    reason: string;
  } | null>(null);
  const [rescheduleForm] = Form.useForm();
  const newRescheduleDate = Form.useWatch('date', rescheduleForm);

  const dateStr = selectedDate.format('YYYY-MM-DD');

  // 当日各时段状态：预约占用 vs 容量上限、在岗人手 vs 需求人手
  const slots = useMemo(
    () =>
      computeDaySlots(
        dateStr,
        state.capacityRules,
        state.appointments,
        state.employees,
        state.schedules,
        state.leaveRequests
      ),
    [dateStr, state.capacityRules, state.appointments, state.employees, state.schedules, state.leaveRequests]
  );

  const overSlots = slots.filter((s) => s.isOver);
  const understaffedSlots = slots.filter((s) => s.isUnderstaffed);
  const totalOverflow = overSlots.reduce((sum, s) => sum + s.overflow, 0);
  const dayLeaves = state.leaveRequests.filter((l) => l.date === dateStr);
  const leaveAffectedCount = dayLeaves.reduce(
    (sum, l) => sum + getLeaveAffectedAppointments(state.appointments, l.employeeId, dateStr).length,
    0
  );

  const findCustomer = (id: string) => state.customers.find((c) => c.id === id);
  const findService = (id: string) => state.services.find((s) => s.id === id);
  const findEmployee = (id: string) => state.employees.find((e) => e.id === id);

  // ---------- 容量规则设置 ----------

  const handleRuleChange = (
    hour: number,
    field: 'maxCustomers' | 'requiredStaff',
    value: number | null
  ) => {
    const current = getRuleCapacity(state.capacityRules, ruleDayOfWeek, hour);
    const existing = state.capacityRules.find(
      (r) => r.dayOfWeek === ruleDayOfWeek && r.hour === hour
    );
    const rule: CapacityRule = {
      id: existing?.id || generateId(),
      dayOfWeek: ruleDayOfWeek,
      hour,
      maxCustomers:
        field === 'maxCustomers' ? value ?? DEFAULT_MAX_CUSTOMERS : current.maxCustomers,
      requiredStaff:
        field === 'requiredStaff' ? value ?? DEFAULT_REQUIRED_STAFF : current.requiredStaff
    };
    dispatch(upsertCapacityRule(rule));
  };

  const ruleColumns = [
    {
      title: '时段',
      key: 'hour',
      width: 140,
      render: (_: unknown, record: { hour: number }) => (
        <Space>
          <ClockCircleOutlined style={{ color: '#C9A86C' }} />
          <span style={{ fontWeight: 500 }}>
            {pad(record.hour)}:00 - {pad(record.hour + 1)}:00
          </span>
        </Space>
      )
    },
    {
      title: '最多接待（位客人）',
      key: 'maxCustomers',
      render: (_: unknown, record: { hour: number }) => {
        const capacity = getRuleCapacity(state.capacityRules, ruleDayOfWeek, record.hour);
        return (
          <InputNumber
            min={1}
            max={20}
            value={capacity.maxCustomers}
            onChange={(v) => handleRuleChange(record.hour, 'maxCustomers', v)}
          />
        );
      }
    },
    {
      title: '需要美容师（位）',
      key: 'requiredStaff',
      render: (_: unknown, record: { hour: number }) => {
        const capacity = getRuleCapacity(state.capacityRules, ruleDayOfWeek, record.hour);
        return (
          <InputNumber
            min={1}
            max={10}
            value={capacity.requiredStaff}
            onChange={(v) => handleRuleChange(record.hour, 'requiredStaff', v)}
          />
        );
      }
    },
    {
      title: '规则来源',
      key: 'source',
      width: 110,
      render: (_: unknown, record: { hour: number }) => {
        const customized = state.capacityRules.some(
          (r) => r.dayOfWeek === ruleDayOfWeek && r.hour === record.hour
        );
        return customized ? <Tag color="gold">自定义</Tag> : <Tag>默认</Tag>;
      }
    }
  ];

  // ---------- 当日核对 ----------

  const openReschedule = (appointment: Appointment, reason: string) => {
    setRescheduleTarget({ appointment, reason });
    rescheduleForm.setFieldsValue({
      date: dayjs(appointment.startTime),
      time: dayjs(appointment.startTime),
      employeeId: appointment.employeeId
    });
  };

  const applyReschedule = (values: { date: dayjs.Dayjs; time: dayjs.Dayjs; employeeId: string }) => {
    if (!rescheduleTarget) return;
    const { appointment, reason } = rescheduleTarget;
    const newStart = dayjs(values.date)
      .hour(values.time.hour())
      .minute(values.time.minute());
    const newEnd = newStart.add(appointment.duration, 'minute');

    dispatch(
      updateAppointment({
        ...appointment,
        employeeId: values.employeeId,
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString()
      })
    );
    const record: RescheduleRecord = {
      id: generateId(),
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      fromTime: appointment.startTime,
      toTime: newStart.toISOString(),
      reason,
      notified: false,
      createdAt: new Date().toISOString()
    };
    dispatch(addRescheduleRecord(record));
    message.success('预约已调整，各时段占用已重新计算，请尽快通知顾客');
    setRescheduleTarget(null);
  };

  const handleRescheduleSubmit = async () => {
    try {
      const values = await rescheduleForm.validateFields();
      if (!rescheduleTarget) return;
      const newDateStr = dayjs(values.date).format('YYYY-MM-DD');
      const newHour = values.time.hour();
      const { maxCustomers } = getSlotCapacity(state.capacityRules, newDateStr, newHour);
      const booked = getSlotAppointments(state.appointments, newDateStr, newHour).filter(
        (a) => a.id !== rescheduleTarget.appointment.id
      ).length;
      if (booked >= maxCustomers) {
        Modal.confirm({
          title: '新时段也将超排',
          content: `${newDateStr} ${pad(newHour)}:00 时段已排 ${booked}/${maxCustomers} 单，继续调整该时段会超排，是否仍要调整？`,
          okText: '仍然调整',
          cancelText: '重新选择',
          onOk: () => applyReschedule(values)
        });
        return;
      }
      applyReschedule(values);
    } catch {
      // validation error
    }
  };

  const slotColumns = [
    {
      title: '时段',
      key: 'hour',
      width: 130,
      render: (_: unknown, slot: SlotStatus) => (
        <span style={{ fontWeight: 500 }}>
          {pad(slot.hour)}:00 - {pad(slot.hour + 1)}:00
        </span>
      )
    },
    {
      title: '预约（已排/上限）',
      key: 'booked',
      width: 150,
      render: (_: unknown, slot: SlotStatus) => (
        <span
          style={{
            fontWeight: 600,
            color: slot.isOver ? '#ff4d4f' : slot.bookedCount === slot.maxCustomers ? '#faad14' : '#3A3A3A'
          }}
        >
          {slot.bookedCount} / {slot.maxCustomers} 单
        </span>
      )
    },
    {
      title: '人手（在岗/需求）',
      key: 'staff',
      width: 150,
      render: (_: unknown, slot: SlotStatus) => (
        <span style={{ fontWeight: 600, color: slot.isUnderstaffed ? '#fa8c16' : '#3A3A3A' }}>
          {slot.workingStaff.length} / {slot.requiredStaff} 人
        </span>
      )
    },
    {
      title: '核对结果',
      key: 'status',
      render: (_: unknown, slot: SlotStatus) => (
        <Space size={4} wrap>
          {!slot.isOver && !slot.isUnderstaffed && <Tag color="green">正常</Tag>}
          {slot.isOver && (
            <Tag color="red" icon={<WarningOutlined />}>
              超排 {slot.overflow} 单
            </Tag>
          )}
          {slot.isUnderstaffed && <Tag color="orange">人手不足，缺 {slot.staffShortage} 人</Tag>}
        </Space>
      )
    }
  ];

  const renderSlotDetail = (slot: SlotStatus) => (
    <div style={{ padding: '4px 8px' }}>
      <div style={{ marginBottom: 8 }}>
        <span style={{ color: '#8c8c8c', marginRight: 8 }}>在岗美容师：</span>
        {slot.workingStaff.length > 0 ? (
          slot.workingStaff.map((e) => <Tag key={e.id}>{e.name}</Tag>)
        ) : (
          <Tag color="red">无人在岗</Tag>
        )}
      </div>
      {slot.appointments.length === 0 ? (
        <div style={{ color: '#8c8c8c' }}>该时段暂无预约</div>
      ) : (
        slot.appointments.map((a) => {
          const customer = findCustomer(a.customerId);
          const service = findService(a.serviceId);
          const employee = findEmployee(a.employeeId);
          const isOverflow = slot.overflowAppointments.some((o) => o.id === a.id);
          return (
            <div
              key={a.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderTop: '1px solid #f5f5f5'
              }}
            >
              <Space size={8} wrap>
                <span style={{ fontWeight: 500 }}>{formatTime(a.startTime)}</span>
                <span>{customer?.name}</span>
                <span style={{ color: '#8c8c8c' }}>{service?.name}</span>
                <span style={{ color: '#8c8c8c' }}>美容师：{employee?.name}</span>
                <Tag color={getStatusColor(a.status)}>{getStatusText(a.status)}</Tag>
                {isOverflow && <Tag color="red">超排·建议挪出</Tag>}
              </Space>
              <Button
                type="link"
                size="small"
                icon={<SwapOutlined />}
                onClick={() => openReschedule(a, isOverflow ? '时段超排调整' : '门店排期调整')}
              >
                调整时间
              </Button>
            </div>
          );
        })
      )}
    </div>
  );

  // ---------- 请假管理 ----------

  const handleLeaveSubmit = async () => {
    try {
      const values = await leaveForm.validateFields();
      const leaveDate = dayjs(values.date).format('YYYY-MM-DD');
      if (
        state.leaveRequests.some(
          (l) => l.employeeId === values.employeeId && l.date === leaveDate
        )
      ) {
        message.warning('该员工当天已登记过请假');
        return;
      }
      const leave: LeaveRequest = {
        id: generateId(),
        employeeId: values.employeeId,
        date: leaveDate,
        reason: values.reason || '临时请假',
        createdAt: new Date().toISOString()
      };
      dispatch(addLeaveRequest(leave));
      setLeaveModalOpen(false);
      const affected = getLeaveAffectedAppointments(
        state.appointments,
        values.employeeId,
        leaveDate
      );
      setSelectedDate(dayjs(leaveDate));
      if (affected.length > 0) {
        message.warning(
          `已登记请假。该员工 ${leaveDate} 有 ${affected.length} 单预约需要挪时间，请在下方逐一处理`
        );
      } else {
        message.success('已登记请假，该员工当天暂无受影响预约');
      }
    } catch {
      // validation error
    }
  };

  // ---------- 改约记录与通知 ----------

  const handleNotify = (record: RescheduleRecord) => {
    const customer = findCustomer(record.customerId);
    const appointment = state.appointments.find((a) => a.id === record.appointmentId);
    const service = appointment ? findService(appointment.serviceId) : undefined;
    Modal.confirm({
      title: '通知顾客',
      width: 480,
      content: (
        <div>
          <p>
            将向顾客 <b>{customer?.name}</b>（{customer?.phone}）发送改约通知：
          </p>
          <Alert
            type="info"
            message={`【雅尚美容院】尊敬的${customer?.name}，因${record.reason}，您的${
              service?.name || ''
            }预约已调整为 ${dayjs(record.toTime).format('MM月DD日 HH:mm')}。如需更改时间，请回复本消息或致电门店，给您带来不便敬请谅解。`}
          />
        </div>
      ),
      okText: '发送通知',
      cancelText: '取消',
      onOk: () => {
        dispatch(
          updateRescheduleRecord({
            ...record,
            notified: true,
            notifiedAt: new Date().toISOString()
          })
        );
        message.success(`已通知顾客 ${customer?.name}`);
      }
    });
  };

  // 该条记录是这位顾客第几次被挪
  const getRecordSeq = (record: RescheduleRecord) => {
    const customerRecords = state.rescheduleRecords
      .filter((r) => r.customerId === record.customerId)
      .sort((a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf());
    return customerRecords.findIndex((r) => r.id === record.id) + 1;
  };

  const rescheduleColumns = [
    {
      title: '顾客',
      key: 'customer',
      render: (_: unknown, record: RescheduleRecord) => {
        const customer = findCustomer(record.customerId);
        return (
          <Space>
            <Avatar size={32} src={customer?.avatar} icon={<UserOutlined />} />
            <div>
              <div style={{ fontWeight: 500 }}>{customer?.name}</div>
              <div style={{ fontSize: 12, color: '#8c8c8c' }}>{customer?.phone}</div>
            </div>
          </Space>
        );
      }
    },
    {
      title: '项目',
      key: 'service',
      render: (_: unknown, record: RescheduleRecord) => {
        const appointment = state.appointments.find((a) => a.id === record.appointmentId);
        return appointment ? findService(appointment.serviceId)?.name : '-';
      }
    },
    {
      title: '时间调整',
      key: 'time',
      render: (_: unknown, record: RescheduleRecord) => (
        <Space size={4}>
          <span style={{ color: '#8c8c8c', textDecoration: 'line-through' }}>
            {dayjs(record.fromTime).format('MM-DD HH:mm')}
          </span>
          <SwapOutlined style={{ color: '#C9A86C' }} />
          <span style={{ fontWeight: 500 }}>{dayjs(record.toTime).format('MM-DD HH:mm')}</span>
        </Space>
      )
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (reason: string) => <Tag>{reason}</Tag>
    },
    {
      title: '累计改约',
      key: 'seq',
      width: 110,
      render: (_: unknown, record: RescheduleRecord) => {
        const total = state.rescheduleRecords.filter(
          (r) => r.customerId === record.customerId
        ).length;
        return (
          <Tag color={total > 1 ? 'purple' : 'default'}>
            第 {getRecordSeq(record)} 次{total > 1 ? ` / 共 ${total} 次` : ''}
          </Tag>
        );
      }
    },
    {
      title: '顾客通知',
      key: 'notified',
      width: 150,
      render: (_: unknown, record: RescheduleRecord) =>
        record.notified ? (
          <Tag color="green">
            已通知 {record.notifiedAt ? dayjs(record.notifiedAt).format('MM-DD HH:mm') : ''}
          </Tag>
        ) : (
          <Tag color="orange">未通知</Tag>
        )
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: RescheduleRecord) =>
        !record.notified && (
          <Button
            type="link"
            size="small"
            icon={<BellOutlined />}
            onClick={() => handleNotify(record)}
          >
            通知顾客
          </Button>
        )
    }
  ];

  // 调整时间弹窗中可选的美容师（排除新日期当天请假的）
  const newDateStr = newRescheduleDate
    ? dayjs(newRescheduleDate).format('YYYY-MM-DD')
    : dateStr;
  const onLeaveIdsOnNewDate = state.leaveRequests
    .filter((l) => l.date === newDateStr)
    .map((l) => l.employeeId);
  const rescheduleEmployeeOptions = state.employees
    .filter(
      (e) => (e.role === 'beautician' || e.role === 'technician') && e.status === 'active'
    )
    .map((e) => ({
      value: e.id,
      label: `${e.name}${onLeaveIdsOnNewDate.includes(e.id) ? '（当天请假）' : ''}`,
      disabled: onLeaveIdsOnNewDate.includes(e.id)
    }));

  const rescheduleCustomer = rescheduleTarget
    ? findCustomer(rescheduleTarget.appointment.customerId)
    : undefined;
  const rescheduleService = rescheduleTarget
    ? findService(rescheduleTarget.appointment.serviceId)
    : undefined;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">时段容量</h1>
          <p className="page-header-subtitle">
            按小时设定接待上限与所需人手，核对预约是否超排、人手是否够用
          </p>
        </div>
        <Space>
          <span style={{ color: '#8c8c8c' }}>核对日期</span>
          <DatePicker
            value={selectedDate}
            onChange={(d) => d && setSelectedDate(d)}
            allowClear={false}
          />
        </Space>
      </div>

      <Tabs
        defaultActiveKey="check"
        items={[
          {
            key: 'check',
            label: '当日核对',
            children: (
              <Card
                className="card-wrapper"
                title={`${dateStr}（${WEEKDAY_LABELS[selectedDate.day()]}）时段核对`}
                bordered={false}
              >
                {overSlots.length > 0 || understaffedSlots.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={`当日有 ${overSlots.length} 个时段超排（共多排 ${totalOverflow} 单）、${understaffedSlots.length} 个时段人手不足`}
                    description="展开对应时段可查看预约明细与在岗人员，超排的预约可直接调整时间。"
                  />
                ) : (
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="当日各时段预约均在接待上限内，人手安排充足"
                  />
                )}
                <Table
                  rowKey="hour"
                  size="middle"
                  pagination={false}
                  columns={slotColumns}
                  dataSource={slots}
                  rowClassName={(slot) =>
                    slot.isOver
                      ? 'slot-row-over'
                      : slot.isUnderstaffed
                      ? 'slot-row-understaffed'
                      : ''
                  }
                  expandable={{
                    expandedRowRender: renderSlotDetail,
                    rowExpandable: () => true
                  }}
                />
              </Card>
            )
          },
          {
            key: 'rules',
            label: '容量规则设置',
            children: (
              <Card
                className="card-wrapper"
                title="按小时设定每个时段的接待上限与所需美容师人数"
                bordered={false}
                extra={
                  <Space>
                    <span style={{ color: '#8c8c8c' }}>应用于</span>
                    <Select
                      value={ruleDayOfWeek}
                      onChange={setRuleDayOfWeek}
                      style={{ width: 110 }}
                      options={WEEKDAY_LABELS.map((label, i) => ({ value: i, label }))}
                    />
                  </Space>
                }
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`修改后自动保存，按星期几生效。未设置的时段按默认上限计算：每时段最多 ${DEFAULT_MAX_CUSTOMERS} 位客人、需 ${DEFAULT_REQUIRED_STAFF} 位美容师。`}
                />
                <Table
                  rowKey="hour"
                  size="middle"
                  pagination={false}
                  columns={ruleColumns}
                  dataSource={BUSINESS_HOURS.map((hour) => ({ hour }))}
                />
              </Card>
            )
          },
          {
            key: 'leave',
            label: (
              <span>
                请假与改约
                {leaveAffectedCount > 0 && (
                  <Tag color="red" style={{ marginLeft: 6 }}>
                    {leaveAffectedCount} 单待挪
                  </Tag>
                )}
              </span>
            ),
            children: (
              <>
                <Card
                  className="card-wrapper"
                  title={`请假管理（${dateStr}）`}
                  bordered={false}
                  extra={
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        leaveForm.resetFields();
                        leaveForm.setFieldsValue({ date: selectedDate });
                        setLeaveModalOpen(true);
                      }}
                    >
                      登记请假
                    </Button>
                  }
                >
                  {understaffedSlots.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="以下时段人手不够用"
                      description={understaffedSlots
                        .map(
                          (s) =>
                            `${pad(s.hour)}:00 - ${pad(s.hour + 1)}:00（在岗 ${s.workingStaff.length} 人 / 需 ${s.requiredStaff} 人）`
                        )
                        .join('、')}
                    />
                  )}
                  {dayLeaves.length === 0 ? (
                    <Empty description="当日暂无请假记录" />
                  ) : (
                    dayLeaves.map((leave) => {
                      const employee = findEmployee(leave.employeeId);
                      const affected = getLeaveAffectedAppointments(
                        state.appointments,
                        leave.employeeId,
                        dateStr
                      );
                      return (
                        <div
                          key={leave.id}
                          style={{
                            border: '1px solid #f0f0f0',
                            borderRadius: 8,
                            padding: 16,
                            marginBottom: 12
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <Space>
                              <Avatar size={36} src={employee?.avatar} icon={<UserOutlined />} />
                              <div>
                                <span style={{ fontWeight: 500 }}>{employee?.name}</span>
                                <span style={{ color: '#8c8c8c', marginLeft: 8 }}>
                                  {getStatusText(employee?.role || '')}
                                </span>
                                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                  请假原因：{leave.reason}
                                </div>
                              </div>
                            </Space>
                            <Popconfirm
                              title="确定撤销该请假吗？"
                              okText="撤销请假"
                              cancelText="取消"
                              onConfirm={() => {
                                dispatch(deleteLeaveRequest(leave.id));
                                message.success('已撤销请假，人手已重新计算');
                              }}
                            >
                              <Button type="link" size="small" icon={<DeleteOutlined />}>
                                销假
                              </Button>
                            </Popconfirm>
                          </div>
                          <div style={{ marginTop: 12 }}>
                            {affected.length > 0 ? (
                              <>
                                <Alert
                                  type="error"
                                  style={{ marginBottom: 8 }}
                                  message={`以下 ${affected.length} 单预约需要挪时间：`}
                                />
                                {affected.map((a) => {
                                  const customer = findCustomer(a.customerId);
                                  const service = findService(a.serviceId);
                                  return (
                                    <div
                                      key={a.id}
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '6px 0',
                                        borderTop: '1px solid #f5f5f5'
                                      }}
                                    >
                                      <Space size={8} wrap>
                                        <span style={{ fontWeight: 500 }}>
                                          {formatTime(a.startTime)}
                                        </span>
                                        <span>{customer?.name}</span>
                                        <span style={{ color: '#8c8c8c' }}>{service?.name}</span>
                                        <Tag color={getStatusColor(a.status)}>
                                          {getStatusText(a.status)}
                                        </Tag>
                                      </Space>
                                      <Button
                                        type="link"
                                        size="small"
                                        icon={<SwapOutlined />}
                                        onClick={() =>
                                          openReschedule(
                                            a,
                                            `美容师${employee?.name || ''}临时请假`
                                          )
                                        }
                                      >
                                        调整时间
                                      </Button>
                                    </div>
                                  );
                                })}
                              </>
                            ) : (
                              <div style={{ color: '#8c8c8c' }}>该员工当天无受影响预约</div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </Card>

                <Card
                  className="card-wrapper"
                  title="改约记录与顾客通知"
                  bordered={false}
                  extra={
                    <Tag color="blue">{state.rescheduleRecords.length} 条改约记录</Tag>
                  }
                >
                  <Table
                    rowKey="id"
                    size="middle"
                    pagination={{ pageSize: 8 }}
                    columns={rescheduleColumns}
                    dataSource={state.rescheduleRecords}
                    locale={{ emptyText: '暂无改约记录' }}
                    scroll={{ x: 'max-content' }}
                  />
                </Card>
              </>
            )
          }
        ]}
      />

      {/* 登记请假 */}
      <Modal
        title="登记临时请假"
        open={leaveModalOpen}
        onOk={handleLeaveSubmit}
        onCancel={() => setLeaveModalOpen(false)}
        okText="确认请假"
        cancelText="取消"
        width={440}
      >
        <Form form={leaveForm} layout="vertical">
          <Form.Item
            name="employeeId"
            label="请假员工"
            rules={[{ required: true, message: '请选择员工' }]}
          >
            <Select
              placeholder="请选择美容师/技师"
              options={state.employees
                .filter(
                  (e) =>
                    (e.role === 'beautician' || e.role === 'technician') &&
                    e.status === 'active'
                )
                .map((e) => ({ value: e.id, label: `${e.name} - ${getStatusText(e.role)}` }))}
            />
          </Form.Item>
          <Form.Item
            name="date"
            label="请假日期"
            rules={[{ required: true, message: '请选择日期' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="请假原因">
            <Input placeholder="如：家中有事、身体不适" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 调整预约时间 */}
      <Modal
        title="调整预约时间"
        open={!!rescheduleTarget}
        onOk={handleRescheduleSubmit}
        onCancel={() => setRescheduleTarget(null)}
        okText="确认调整"
        cancelText="取消"
        width={480}
        forceRender
      >
        {rescheduleTarget && (
          <>
            <Alert
              type="info"
              style={{ marginBottom: 16 }}
              message={`原预约：${dayjs(rescheduleTarget.appointment.startTime).format(
                'MM月DD日 HH:mm'
              )} · ${rescheduleCustomer?.name} · ${rescheduleService?.name}`}
              description={`调整原因：${rescheduleTarget.reason}。调整后时段占用将自动重新计算。`}
            />
            <Form form={rescheduleForm} layout="vertical">
              <Form.Item
                name="employeeId"
                label="美容师"
                rules={[{ required: true, message: '请选择美容师' }]}
              >
                <Select placeholder="请选择美容师" options={rescheduleEmployeeOptions} />
              </Form.Item>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="date"
                    label="新日期"
                    rules={[{ required: true, message: '请选择日期' }]}
                  >
                    <DatePicker
                      style={{ width: '100%' }}
                      disabledDate={(d) => d && d.isBefore(dayjs().startOf('day'))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="time"
                    label="新时间"
                    rules={[{ required: true, message: '请选择时间' }]}
                  >
                    <TimePicker
                      style={{ width: '100%' }}
                      format="HH:mm"
                      minuteStep={15}
                      disabledHours={() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 21, 22, 23]}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
};

export default CapacityManage;
