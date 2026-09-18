import React, { useMemo, useState } from 'react';
import {
  Row,
  Col,
  Card,
  Table,
  Tag,
  Button,
  Space,
  DatePicker,
  Modal,
  Form,
  Select,
  TimePicker,
  InputNumber,
  Input,
  message,
  Tooltip,
  Avatar,
  Statistic,
  Alert,
  Popconfirm,
  Badge,
  Empty,
  Divider,
} from 'antd';
import {
  WarningOutlined,
  TeamOutlined,
  CalendarOutlined,
  ReloadOutlined,
  PlusOutlined,
  CloseCircleOutlined,
  BellOutlined,
  ArrowRightOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import type { RootState } from '../../store';
import {
  saveCapacityRules,
  addLeaveRecord,
  cancelLeaveRecord,
  rescheduleAppointment,
  markNotificationRead,
} from '../../store';
import type {
  Appointment,
  CapacityRule,
  LeaveRecord,
} from '../../types';
import {
  analyzeDayCapacity,
  weekdayLabel,
  getCustomerRescheduleCount,
  checkBooking,
  OPEN_HOUR,
  CLOSE_HOUR,
  type SlotAnalysis,
} from '../../utils/capacity';
import { formatDate, formatTime, generateId, getStatusText } from '../../utils/format';
import dayjs from 'dayjs';

const { RangePicker } = TimePicker;

const CapacityPage: React.FC = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const state = useSelector((s: RootState) => s.app);
  const [selectedDate, setSelectedDate] = useState(
    dayjs((location.state as { date?: string } | null)?.date || undefined)
  );
  const [configWeekday, setConfigWeekday] = useState<number>(
    dayjs((location.state as { date?: string } | null)?.date || undefined).day()
  );
  const [ruleDraft, setRuleDraft] = useState<CapacityRule[]>([]);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm] = Form.useForm();
  const [moveTarget, setMoveTarget] = useState<Appointment | null>(null);
  const [moveForm] = Form.useForm();
  const [detailSlot, setDetailSlot] = useState<SlotAnalysis | null>(null);

  const dateStr = selectedDate.format('YYYY-MM-DD');

  const analysis = useMemo(
    () =>
      analyzeDayCapacity({
        date: dateStr,
        appointments: state.appointments,
        rules: state.capacityRules,
        employees: state.employees,
        schedules: state.schedules,
        leaves: state.leaveRecords,
      }),
    [dateStr, state.appointments, state.capacityRules, state.employees, state.schedules, state.leaveRecords]
  );

  const staffOptions = state.employees
    .filter((e) => (e.role === 'beautician' || e.role === 'technician') && e.status === 'active')
    .map((e) => ({ value: e.id, label: `${e.name} · ${getStatusText(e.role)}` }));

  // ---------- 容量规则编辑 ----------
  // 页面展示的草稿：正在编辑的星期对应 ruleDraft，否则直接从规则派生
  const visibleDraft = useMemo(() => {
    if (ruleDraft.length && ruleDraft[0].weekday === configWeekday) return ruleDraft;
    const rows = state.capacityRules
      .filter((r) => r.weekday === configWeekday)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    return rows.map((r) => ({ ...r }));
  }, [ruleDraft, configWeekday, state.capacityRules]);

  const updateDraft = (startTime: string, patch: Partial<CapacityRule>) => {
    setRuleDraft((prev) => {
      const base = prev.length && prev[0].weekday === configWeekday ? prev : visibleDraft;
      return base.map((r) => (r.startTime === startTime ? { ...r, ...patch } : r));
    });
  };

  const handleSaveRules = () => {
    const draft = ruleDraft.length && ruleDraft[0].weekday === configWeekday ? ruleDraft : visibleDraft;
    if (draft.some((r) => r.maxBookings < 1 || r.requiredStaff < 0)) {
      message.error('上限至少为 1，所需人手不能小于 0');
      return;
    }
    dispatch(saveCapacityRules(draft));
    message.success(`${weekdayLabel(configWeekday)}容量规则已保存`);
  };

  // ---------- 请假 ----------
  const handleAddLeave = async () => {
    const values = await leaveForm.validateFields();
    const isFullDay = values.type === 'full_day';
    const record: LeaveRecord = {
      id: generateId(),
      employeeId: values.employeeId,
      date: values.date.format('YYYY-MM-DD'),
      startTime: isFullDay ? '09:00' : values.range[0].format('HH:mm'),
      endTime: isFullDay ? '21:00' : values.range[1].format('HH:mm'),
      reason: values.reason || '',
      type: values.type,
      createdAt: new Date().toISOString(),
      cancelled: false,
    };
    dispatch(addLeaveRecord(record));
    message.success('请假已登记，受影响时段已重新核算');
    setLeaveOpen(false);
    leaveForm.resetFields();
  };

  // ---------- 挪单 ----------
  const openMove = (a: Appointment) => {
    setMoveTarget(a);
    moveForm.resetFields();
    moveForm.setFieldsValue({
      date: dayjs(a.startTime),
      time: dayjs(a.startTime),
      employeeId: a.employeeId,
    });
  };

  const handleMove = async () => {
    if (!moveTarget) return;
    const values = await moveForm.validateFields();
    const start = values.date
      .hour(values.time.hour())
      .minute(values.time.minute())
      .second(0)
      .millisecond(0);
    const end = start.add(moveTarget.duration, 'minute');

    if (start.valueOf() === dayjs(moveTarget.startTime).valueOf() && values.employeeId === moveTarget.employeeId) {
      message.warning('时间或美容师没有变化');
      return;
    }

    // 对挪入的目标时段再算一遍账，仍超员/缺人时给出提示但允许确认
    const startMin = start.hour() * 60 + start.minute();
    const targetDate = start.format('YYYY-MM-DD');
    const check = checkBooking(
      targetDate,
      startMin,
      moveTarget.duration,
      values.employeeId,
      {
        appointments: state.appointments.filter((a) => a.id !== moveTarget.id),
        rules: state.capacityRules,
        employees: state.employees,
        schedules: state.schedules,
        leaves: state.leaveRecords,
      }
    );

    const doMove = () => {
      const prevCount = getCustomerRescheduleCount(state.notifications, moveTarget.customerId);
      const updated: Appointment = {
        ...moveTarget,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        employeeId: values.employeeId,
        status: 'confirmed',
      };
      dispatch(
        rescheduleAppointment({
          appointment: updated,
          notification: {
            id: generateId(),
            appointmentId: moveTarget.id,
            customerId: moveTarget.customerId,
            fromTime: moveTarget.startTime,
            toTime: updated.startTime,
            rescheduleCount: prevCount + 1,
            reason:
              values.employeeId !== moveTarget.employeeId
                ? '美容师临时请假/人手调整，为您改约并更换服务美容师'
                : '原时段临时无法接待，为您协调其他时段',
            createdAt: new Date().toISOString(),
            status: 'sent',
          },
        })
      );
      message.success('预约已挪动，顾客通知已发送，时段占用已重新计算');
      setMoveTarget(null);
    };

    if (check.slotOverbooked || check.employeeOnLeave) {
      Modal.confirm({
        title: '目标时段仍有风险',
        content: `目标时段${check.slotOverbooked ? '已排满/会超员' : ''}${
          check.slotOverbooked && check.employeeOnLeave ? '，且' : ''
        }${check.employeeOnLeave ? '该美容师正在请假' : ''}，确认仍要挪到这里吗？`,
        okText: '仍然挪动',
        cancelText: '再想想',
        onOk: doMove,
      });
      return;
    }
    doMove();
  };

  // ---------- 表格 ----------
  const slotColumns = [
    {
      title: '时段',
      dataIndex: 'time',
      key: 'time',
      width: 90,
      render: (_: unknown, row: SlotAnalysis) => (
        <b>{row.slot.startTime}-{row.slot.endTime}</b>
      ),
    },
    {
      title: '容量上限',
      dataIndex: 'max',
      key: 'max',
      width: 80,
      render: (_: unknown, row: SlotAnalysis) => `${row.rule.maxBookings} 位`,
    },
    {
      title: '已排 / 多排',
      key: 'booked',
      width: 130,
      render: (_: unknown, row: SlotAnalysis) => (
        <Space size={6}>
          <Tag color={row.overbooked > 0 ? 'red' : row.booked >= row.rule.maxBookings ? 'orange' : 'green'}>
            {row.booked} / {row.rule.maxBookings}
          </Tag>
          {row.overbooked > 0 && <Tag color="red">多排 {row.overbooked} 单</Tag>}
        </Space>
      ),
    },
    {
      title: '在岗 / 需美容师',
      key: 'staff',
      width: 150,
      render: (_: unknown, row: SlotAnalysis) => (
        <Space size={6} wrap>
          <Tag color={row.staffShortage > 0 ? 'red' : 'blue'}>
            {row.staffOnDuty} / {row.rule.requiredStaff}
          </Tag>
          {row.staffShortage > 0 && <Tag color="red">缺 {row.staffShortage} 人</Tag>}
          {row.staffOnLeave.length > 0 && (
            <Tooltip title={row.staffOnLeave.map((e) => `${e.name}请假中`).join('；')}>
              <Tag icon={<StopOutlined />} color="orange">
                {row.staffOnLeave.length} 人请假
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_: unknown, row: SlotAnalysis) => {
        if (row.overbooked > 0) return <Badge status="error" text="超出上限" />;
        if (row.staffShortage > 0) return <Badge status="warning" text="人手不足" />;
        if (row.booked >= row.rule.maxBookings) return <Badge status="warning" text="已排满" />;
        return <Badge status="success" text="可接单" />;
      },
    },
    {
      title: '占用明细 / 操作',
      key: 'actions',
      render: (_: unknown, row: SlotAnalysis) => (
        <Space>
          <Button type="link" size="small" onClick={() => setDetailSlot(row)}>
            查看 {row.booked} 单
          </Button>
          {row.overbooked > 0 && (
            <Tooltip title="按最晚排上来优先，列出该时段多出来的预约">
              <Button
                type="link"
                size="small"
                danger
                onClick={() => {
                  const target = analysis.appointmentsToMove.find((m) =>
                    m.reasons.some(
                      (r) => r.type === 'overbooked' && r.slot.slot.startTime === row.slot.startTime
                    )
                  );
                  if (target) openMove(target.appointment);
                  else message.info('该时段超员预约已在下方待挪单列表中');
                }}
              >
                去挪单
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const moveReasonsText = (
    reasons: ReturnType<typeof analyzeDayCapacity>['appointmentsToMove'][number]['reasons']
  ) =>
    reasons
      .map((r) =>
        r.type === 'leave'
          ? `${r.employee.name}${r.slot.slot.startTime}时段请假`
          : `${r.slot.slot.startTime}时段多排${r.slot.overbooked}单`
      )
      .join('；');

  const dayNotifications = state.notifications
    .filter((n) => dayjs(n.toTime).isSame(dateStr, 'day'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalOverbooked = analysis.overbookedSlots.reduce((sum, s) => sum + s.overbooked, 0);
  const moveCount = analysis.appointmentsToMove.length;
  const dayBookedCount = state.appointments.filter(
    (a) =>
      dayjs(a.startTime).isSame(dateStr, 'day') &&
      a.status !== 'cancelled' &&
      a.status !== 'no_show'
  ).length;

  const renderAppointmentTag = (a: Appointment) => {
    const customer = state.customers.find((c) => c.id === a.customerId);
    const service = state.services.find((s) => s.id === a.serviceId);
    const employee = state.employees.find((e) => e.id === a.employeeId);
    const moveTotal = getCustomerRescheduleCount(state.notifications, a.customerId);
    return (
      <Space size={8}>
        <Avatar size={28} src={customer?.avatar} />
        <span>{customer?.name || '未知顾客'}</span>
        <span style={{ color: '#8c8c8c' }}>
          {formatTime(a.startTime)} {service?.name} · {employee?.name}
        </span>
        {moveTotal > 0 && <Tag color="purple">历史已挪 {moveTotal} 次</Tag>}
      </Space>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">接客容量对账</h1>
          <p className="page-header-subtitle">
            按小时核算每天最多接几位、需要几位美容师；超员时段、请假缺人、待挪单一目了然
          </p>
        </div>
        <Space>
          <DatePicker
            value={selectedDate}
            onChange={(d) => d && setSelectedDate(d)}
            allowClear={false}
          />
          <Button icon={<ReloadOutlined />} onClick={() => setSelectedDate(dayjs())}>
            今天
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setLeaveOpen(true)}>
            美容师临时请假
          </Button>
        </Space>
      </div>

      {/* 当天概览 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card className="card-wrapper">
            <Statistic
              title="当天预约总数"
              value={dayBookedCount}
              prefix={<CalendarOutlined style={{ color: '#C9A86C' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="card-wrapper">
            <Statistic
              title="超员时段"
              value={analysis.overbookedSlots.length}
              suffix={`个 / 共${totalOverbooked}单`}
              valueStyle={{ color: analysis.overbookedSlots.length ? '#ff4d4f' : '#3A3A3A' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="card-wrapper">
            <Statistic
              title="人手不足时段"
              value={analysis.shortageSlots.length}
              suffix="个"
              valueStyle={{ color: analysis.shortageSlots.length ? '#faad14' : '#3A3A3A' }}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="card-wrapper">
            <Statistic
              title="需要挪动的预约"
              value={moveCount}
              suffix="单"
              valueStyle={{ color: moveCount ? '#ff4d4f' : '#3A3A3A' }}
              prefix={<ReloadOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 超员/缺人提示横幅 */}
      {(analysis.overbookedSlots.length > 0 || analysis.shortageSlots.length > 0) && (
        <Alert
          style={{ marginBottom: 16 }}
          type={analysis.overbookedSlots.length > 0 ? 'error' : 'warning'}
          showIcon
          message={
            analysis.overbookedSlots.length > 0
              ? `${formatDate(dateStr)} 有 ${analysis.overbookedSlots.length} 个时段排超了，共多排 ${totalOverbooked} 单`
              : `${formatDate(dateStr)} 人手不足但未超员`
          }
          description={
            <Space direction="vertical" size={2}>
              {analysis.overbookedSlots.map((s) => (
                <span key={`ob-${s.slot.startTime}`}>
                  · {s.slot.startTime}-{s.slot.endTime} 上限 {s.rule.maxBookings} 位，已排 {s.booked} 单，
                  <b style={{ color: '#ff4d4f' }}>多排 {s.overbooked} 单</b>
                </span>
              ))}
              {analysis.shortageSlots.map((s) => (
                <span key={`st-${s.slot.startTime}`} style={{ color: '#ad6800' }}>
                  · {s.slot.startTime}-{s.slot.endTime} 需 {s.rule.requiredStaff} 位美容师，实际在岗{' '}
                  {s.staffOnDuty} 位
                  {s.staffOnLeave.length > 0 &&
                    `（${s.staffOnLeave.map((e) => e.name).join('、')}请假）`}
                  ，<b>缺 {s.staffShortage} 人</b>
                </span>
              ))}
            </Space>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          {/* 逐小时对账表 */}
          <Card
            className="card-wrapper"
            title={`${formatDate(dateStr)}（${weekdayLabel(selectedDate.day())}）逐小时占用`}
            bordered={false}
          >
            <Table
              rowKey={(r) => r.slot.startTime}
              columns={slotColumns}
              dataSource={analysis.slots}
              pagination={false}
              size="small"
              rowClassName={(r) =>
                r.overbooked > 0
                  ? 'capacity-row-danger'
                  : r.staffShortage > 0
                  ? 'capacity-row-warning'
                  : r.booked >= r.rule.maxBookings
                  ? 'capacity-row-full'
                  : ''
              }
            />
          </Card>

          {/* 待挪单列表 */}
          <Card
            className="card-wrapper"
            title={
              <Space>
                <span>需要挪动时间的预约</span>
                <Tag color={moveCount ? 'red' : 'green'}>{moveCount} 单</Tag>
              </Space>
            }
            bordered={false}
          >
            {analysis.appointmentsToMove.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="该日期没有需要挪动的预约，各时段均在容量范围内"
              />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {analysis.appointmentsToMove.map((item) => (
                  <div key={item.appointment.id} className="move-item">
                    <div style={{ flex: 1 }}>{renderAppointmentTag(item.appointment)}</div>
                    <Space direction="vertical" align="end" size={4}>
                      <Tag color="red">{moveReasonsText(item.reasons)}</Tag>
                      <Button type="primary" size="small" icon={<ArrowRightOutlined />} onClick={() => openMove(item.appointment)}>
                        挪动并通知
                      </Button>
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          {/* 容量规则配置 */}
          <Card
            className="card-wrapper"
            title="每小时容量设置（按星期模板）"
            bordered={false}
            extra={
              <Select
                size="small"
                value={configWeekday}
                style={{ width: 90 }}
                onChange={(v) => {
                  setConfigWeekday(v);
                  setRuleDraft([]);
                }}
                options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({
                  value: d,
                  label: weekdayLabel(d),
                }))}
              />
            }
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`正在编辑「${weekdayLabel(configWeekday)}」模板，修改后对所有${weekdayLabel(configWeekday)}生效`}
            />
            <div className="rule-edit-list">
              <div className="rule-edit-head">
                <span>时段</span>
                <span>最多接待</span>
                <span>需美容师</span>
              </div>
              {visibleDraft.map((r) => (
                <div className="rule-edit-row" key={r.startTime}>
                  <span>
                    {r.startTime}-{r.endTime}
                  </span>
                  <InputNumber
                    size="small"
                    min={0}
                    max={20}
                    value={r.maxBookings}
                    addonAfter="位"
                    onChange={(v) => updateDraft(r.startTime, { maxBookings: v ?? 0 })}
                  />
                  <InputNumber
                    size="small"
                    min={0}
                    max={10}
                    value={r.requiredStaff}
                    addonAfter="人"
                    onChange={(v) => updateDraft(r.startTime, { requiredStaff: v ?? 0 })}
                  />
                </div>
              ))}
            </div>
            <Button type="primary" block style={{ marginTop: 12 }} onClick={handleSaveRules}>
              保存{weekdayLabel(configWeekday)}容量规则
            </Button>
          </Card>

          {/* 请假情况 */}
          <Card
            className="card-wrapper"
            title={`${formatDate(dateStr)} 美容师请假`}
            bordered={false}
            extra={
              <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => setLeaveOpen(true)}>
                登记请假
              </Button>
            }
          >
            {analysis.activeLeaves.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当天无人请假" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {analysis.activeLeaves.map((lv) => {
                  const employee = state.employees.find((e) => e.id === lv.employeeId);
                  const affected = analysis.appointmentsToMove.filter((m) =>
                    m.reasons.some((r) => r.type === 'leave' && r.employee.id === lv.employeeId)
                  );
                  return (
                    <div key={lv.id} className="leave-item">
                      <Space align="start" style={{ width: '100%' }}>
                        <Avatar size={36} src={employee?.avatar} />
                        <div style={{ flex: 1 }}>
                          <Space>
                            <b>{employee?.name}</b>
                            <Tag color="orange">{lv.type === 'full_day' ? '全天请假' : '部分时段'}</Tag>
                          </Space>
                          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                            {lv.startTime}-{lv.endTime}
                            {lv.reason ? ` · ${lv.reason}` : ''}
                          </div>
                          <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 2 }}>
                            影响 {affected.length} 单需要挪时间
                          </div>
                        </div>
                        <Popconfirm
                          title="撤销该请假记录？"
                          description="撤销后人手与占用将重新计算"
                          onConfirm={() => {
                            dispatch(cancelLeaveRecord(lv.id));
                            message.success('请假已撤销');
                          }}
                        >
                          <Button size="small" type="text" danger icon={<CloseCircleOutlined />}>
                            撤销
                          </Button>
                        </Popconfirm>
                      </Space>
                    </div>
                  );
                })}
              </Space>
            )}
          </Card>

          {/* 当天改约通知 */}
          <Card
            className="card-wrapper"
            title={
              <Space>
                <BellOutlined />
                <span>改约通知</span>
                <Tag color="purple">{state.notifications.length} 条累计</Tag>
              </Space>
            }
            bordered={false}
          >
            {dayNotifications.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当天暂无改约通知" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {dayNotifications.map((n) => {
                  const customer = state.customers.find((c) => c.id === n.customerId);
                  return (
                    <div
                      key={n.id}
                      className="notif-item"
                      onClick={() => n.status === 'sent' && dispatch(markNotificationRead(n.id))}
                    >
                      <Space align="start" style={{ width: '100%' }}>
                        <Badge status={n.status === 'sent' ? 'processing' : 'default'} />
                        <div style={{ flex: 1 }}>
                          <Space size={6} wrap>
                            <b>{customer?.name}</b>
                            <Tag color="purple">第 {n.rescheduleCount} 次被改约</Tag>
                            {n.status === 'sent' && <Tag color="blue">新发送</Tag>}
                          </Space>
                          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
                            {formatTime(n.fromTime)} <ArrowRightOutlined /> {formatDate(n.toTime, 'MM/DD')}{' '}
                            {formatTime(n.toTime)} · {n.reason}
                          </div>
                        </div>
                      </Space>
                    </div>
                  );
                })}
              </Space>
            )}
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              同一顾客的累计改约次数可在「顾客管理 → 顾客详情」中查看完整记录。
            </div>
          </Card>
        </Col>
      </Row>

      {/* 占用明细弹窗 */}
      <Modal
        title={detailSlot ? `${detailSlot.slot.startTime}-${detailSlot.slot.endTime} 时段占用明细` : ''}
        open={!!detailSlot}
        onCancel={() => setDetailSlot(null)}
        footer={null}
        width={620}
      >
        {detailSlot && (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Tag color="blue">已排 {detailSlot.booked} 单</Tag>
              <Tag>上限 {detailSlot.rule.maxBookings} 位</Tag>
              <Tag color="green">在岗 {detailSlot.staffOnDuty} 人</Tag>
              <Tag>需 {detailSlot.rule.requiredStaff} 人</Tag>
              {detailSlot.overbooked > 0 && <Tag color="red">多排 {detailSlot.overbooked} 单</Tag>}
              {detailSlot.staffShortage > 0 && <Tag color="red">缺 {detailSlot.staffShortage} 人</Tag>}
            </Space>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={[...detailSlot.appointments].sort(
                (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
              )}
              columns={[
                {
                  title: '时间',
                  key: 'time',
                  width: 110,
                  render: (_: unknown, a: Appointment) =>
                    `${formatTime(a.startTime)}-${formatTime(a.endTime)}`,
                },
                {
                  title: '顾客 / 项目 / 美容师',
                  key: 'info',
                  render: (_: unknown, a: Appointment) => renderAppointmentTag(a),
                },
                {
                  title: '操作',
                  key: 'op',
                  width: 90,
                  render: (_: unknown, a: Appointment) => (
                    <Button type="link" size="small" onClick={() => { setDetailSlot(null); openMove(a); }}>
                      挪动
                    </Button>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>

      {/* 请假登记弹窗 */}
      <Modal
        title="美容师临时请假"
        open={leaveOpen}
        onOk={handleAddLeave}
        onCancel={() => setLeaveOpen(false)}
        okText="登记请假"
        cancelText="取消"
      >
        <Form form={leaveForm} layout="vertical" initialValues={{ type: 'full_day', date: selectedDate }}>
          <Form.Item name="employeeId" label="请假美容师" rules={[{ required: true, message: '请选择美容师' }]}>
            <Select placeholder="选择美容师" options={staffOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="date" label="请假日期" rules={[{ required: true, message: '请选择日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label="请假类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'full_day', label: '全天（09:00-21:00）' },
                    { value: 'partial', label: '部分时段' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) =>
              getFieldValue('type') === 'partial' ? (
                <Form.Item
                  name="range"
                  label="请假时段"
                  rules={[{ required: true, message: '请选择请假起止时间' }]}
                >
                  <RangePicker
                    style={{ width: '100%' }}
                    format="HH:mm"
                    minuteStep={15}
                    hideDisabledOptions
                    disabledHours={() =>
                      Array.from({ length: 24 }, (_, i) => i).filter(
                        (h) => h < OPEN_HOUR || h >= CLOSE_HOUR
                      )
                    }
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="reason" label="请假原因">
            <Input.TextArea rows={2} placeholder="如：身体不适、家中有事" />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            message="登记后，该美容师请假时段内的预约会自动列入「需要挪动」清单"
          />
        </Form>
      </Modal>

      {/* 挪单弹窗 */}
      <Modal
        title="挪动预约并通知顾客"
        open={!!moveTarget}
        onOk={handleMove}
        onCancel={() => setMoveTarget(null)}
        okText="确认挪动并发送通知"
        cancelText="取消"
        width={520}
      >
        {moveTarget && (
          <Form form={moveForm} layout="vertical">
            {renderAppointmentTag(moveTarget)}
            <Divider style={{ margin: '12px 0' }} />
            <Alert
              style={{ marginBottom: 12 }}
              type="info"
              showIcon
              message={
                (() => {
                  const total = getCustomerRescheduleCount(state.notifications, moveTarget.customerId);
                  const customer = state.customers.find((c) => c.id === moveTarget.customerId);
                  return total > 0
                    ? `${customer?.name} 此前已被挪动 ${total} 次，本次将是第 ${total + 1} 次`
                    : `${customer?.name} 此前未被挪动过，本次是第 1 次`;
                })()
              }
            />
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="date" label="改约日期" rules={[{ required: true, message: '请选择日期' }]}>
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="time" label="改约时间" rules={[{ required: true, message: '请选择时间' }]}>
                  <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={15} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="employeeId" label="服务美容师" rules={[{ required: true, message: '请选择美容师' }]}>
              <Select options={staffOptions} showSearch optionFilterProp="label" />
            </Form.Item>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>
              确认后系统将向顾客发送改约通知，并按新时间重新核算各时段占用。
            </div>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default CapacityPage;
