import dayjs from 'dayjs';
import type { Appointment, CapacityRule, Employee, LeaveRequest, Schedule } from '../types';

// 营业时段：09:00 - 21:00，按小时划分
export const BUSINESS_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

// 未配置规则时的默认上限
export const DEFAULT_MAX_CUSTOMERS = 3;
export const DEFAULT_REQUIRED_STAFF = 2;

// 占用时段容量的预约状态（已取消/爽约不占位）
export const OCCUPYING_STATUSES: Appointment['status'][] = ['pending', 'confirmed'];

export interface SlotCapacity {
  maxCustomers: number;
  requiredStaff: number;
}

export const getRuleCapacity = (
  rules: CapacityRule[],
  dayOfWeek: number,
  hour: number
): SlotCapacity => {
  const rule = rules.find((r) => r.dayOfWeek === dayOfWeek && r.hour === hour);
  return {
    maxCustomers: rule ? rule.maxCustomers : DEFAULT_MAX_CUSTOMERS,
    requiredStaff: rule ? rule.requiredStaff : DEFAULT_REQUIRED_STAFF,
  };
};

export const getSlotCapacity = (
  rules: CapacityRule[],
  date: string,
  hour: number
): SlotCapacity => getRuleCapacity(rules, dayjs(date).day(), hour);

// 某时段内占用容量的预约（按开始时间所在小时计）
export const getSlotAppointments = (
  appointments: Appointment[],
  date: string,
  hour: number
): Appointment[] =>
  appointments
    .filter(
      (a) =>
        OCCUPYING_STATUSES.includes(a.status) &&
        dayjs(a.startTime).format('YYYY-MM-DD') === date &&
        dayjs(a.startTime).hour() === hour
    )
    .sort((a, b) => dayjs(a.startTime).valueOf() - dayjs(b.startTime).valueOf());

// 某时段实际在岗的美容师/技师（排除休息与请假）
export const getWorkingEmployees = (
  employees: Employee[],
  schedules: Schedule[],
  leaves: LeaveRequest[],
  date: string,
  hour: number
): Employee[] => {
  const onLeaveIds = leaves.filter((l) => l.date === date).map((l) => l.employeeId);
  return employees.filter((e) => {
    if (e.status !== 'active') return false;
    if (e.role !== 'beautician' && e.role !== 'technician') return false;
    if (onLeaveIds.includes(e.id)) return false;
    const schedule = schedules.find((s) => s.employeeId === e.id && s.date === date);
    if (!schedule || schedule.shiftType === 'off' || schedule.startTime === '--') return false;
    const startHour = parseInt(schedule.startTime.split(':')[0], 10);
    const endHour = parseInt(schedule.endTime.split(':')[0], 10);
    return hour >= startHour && hour < endHour;
  });
};

export interface SlotStatus {
  hour: number;
  maxCustomers: number;
  requiredStaff: number;
  bookedCount: number;
  appointments: Appointment[];
  // 超出上限、建议挪出的预约（按开始时间排序，超出部分）
  overflowAppointments: Appointment[];
  workingStaff: Employee[];
  overflow: number; // 多排了几单
  staffShortage: number; // 缺几位美容师
  isOver: boolean;
  isUnderstaffed: boolean;
}

// 计算某一天的全部时段状态：预约占用 vs 容量上限、在岗人手 vs 需求人手
export const computeDaySlots = (
  date: string,
  rules: CapacityRule[],
  appointments: Appointment[],
  employees: Employee[],
  schedules: Schedule[],
  leaves: LeaveRequest[]
): SlotStatus[] =>
  BUSINESS_HOURS.map((hour) => {
    const { maxCustomers, requiredStaff } = getSlotCapacity(rules, date, hour);
    const slotAppointments = getSlotAppointments(appointments, date, hour);
    const workingStaff = getWorkingEmployees(employees, schedules, leaves, date, hour);
    const overflow = Math.max(0, slotAppointments.length - maxCustomers);
    const staffShortage = Math.max(0, requiredStaff - workingStaff.length);
    return {
      hour,
      maxCustomers,
      requiredStaff,
      bookedCount: slotAppointments.length,
      appointments: slotAppointments,
      overflowAppointments: slotAppointments.slice(maxCustomers),
      workingStaff,
      overflow,
      staffShortage,
      isOver: overflow > 0,
      isUnderstaffed: staffShortage > 0,
    };
  });

// 请假员工当天需要挪时间的预约
export const getLeaveAffectedAppointments = (
  appointments: Appointment[],
  employeeId: string,
  date: string
): Appointment[] =>
  appointments
    .filter(
      (a) =>
        a.employeeId === employeeId &&
        OCCUPYING_STATUSES.includes(a.status) &&
        dayjs(a.startTime).format('YYYY-MM-DD') === date
    )
    .sort((a, b) => dayjs(a.startTime).valueOf() - dayjs(b.startTime).valueOf());

// 同一顾客累计被挪次数
export const getCustomerRescheduleCount = (
  records: { customerId: string }[],
  customerId: string
): number => records.filter((r) => r.customerId === customerId).length;
