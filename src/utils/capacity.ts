import type {
  Appointment,
  CapacityRule,
  Employee,
  LeaveRecord,
  RescheduleNotification,
  Schedule,
} from '../types';
import dayjs from 'dayjs';

/** 营业小时：9:00 - 21:00，共 12 个整点时段 */
export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 21;
export const SLOT_DURATION_MIN = 60;

export interface SlotDef {
  /** 时段序号 0-11 */
  index: number;
  startTime: string;
  endTime: string;
  /** 当天分钟表示，如 540 = 09:00 */
  startMin: number;
  endMin: number;
}

export const buildSlots = (): SlotDef[] => {
  const slots: SlotDef[] = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    slots.push({
      index: h - OPEN_HOUR,
      startTime: `${String(h).padStart(2, '0')}:00`,
      endTime: `${String(h + 1).padStart(2, '0')}:00`,
      startMin: h * 60,
      endMin: (h + 1) * 60,
    });
  }
  return slots;
};

export const SLOTS = buildSlots();

export const weekdayLabel = (weekday: number): string =>
  ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday];

const hhmmToMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** 预约是否参与占用计算（已取消、爽约不占位） */
export const isActiveAppointment = (a: Appointment): boolean =>
  a.status !== 'cancelled' && a.status !== 'no_show';

/**
 * 默认容量模板：工作日午间高峰多接、需要更多人；周末整体降低；
 * 周一为店内轮休日，容量最低。
 */
export const buildDefaultRules = (): CapacityRule[] => {
  const rules: CapacityRule[] = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    SLOTS.forEach((slot) => {
      const hour = OPEN_HOUR + slot.index;
      let maxBookings = 4;
      let requiredStaff = 2;
      const peak = hour >= 10 && hour <= 14;
      const evening = hour >= 18 && hour <= 19;
      if (weekday === 1) {
        // 周一轮休
        maxBookings = peak || evening ? 2 : 1;
        requiredStaff = 1;
      } else if (weekday === 0 || weekday === 6) {
        // 周末
        maxBookings = peak || evening ? 4 : 3;
        requiredStaff = peak || evening ? 3 : 2;
      } else if (peak) {
        // 工作日高峰：每单配 1 名美容师，满负荷需 6 人
        maxBookings = 6;
        requiredStaff = 6;
      } else if (evening) {
        maxBookings = 5;
        requiredStaff = 4;
      } else if (hour === 9 || hour >= 15) {
        maxBookings = 4;
        requiredStaff = 3;
      }
      rules.push({
        weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxBookings,
        requiredStaff,
      });
    });
  }
  return rules;
};

const STAFF_ROLES: Employee['role'][] = ['beautician', 'technician'];

/** 员工在某天某分钟段内是否在岗（依据排班，无排班记录时默认全天） */
const isEmployeeScheduled = (
  employee: Employee,
  dateStr: string,
  fromMin: number,
  toMin: number,
  schedules: Schedule[]
): boolean => {
  const sc = schedules.find((s) => s.employeeId === employee.id && s.date === dateStr);
  const shiftType = sc?.shiftType ?? (dayjs(dateStr).day() === 1 ? 'off' : 'full_day');
  if (shiftType === 'off') return false;
  const shiftStart = sc && sc.startTime !== '--' ? hhmmToMin(sc.startTime) : OPEN_HOUR * 60;
  const shiftEnd = sc && sc.endTime !== '--' ? hhmmToMin(sc.endTime) : CLOSE_HOUR * 60;
  return toMin > shiftStart && fromMin < shiftEnd;
};

/** 员工在某天某分钟段内是否请假 */
const isEmployeeOnLeave = (
  employee: Employee,
  dateStr: string,
  fromMin: number,
  toMin: number,
  leaves: LeaveRecord[]
): boolean =>
  leaves.some((lv) => {
    if (lv.employeeId !== employee.id || lv.date !== dateStr || lv.cancelled) return false;
    const lvStart = hhmmToMin(lv.startTime);
    const lvEnd = hhmmToMin(lv.endTime);
    return toMin > lvStart && fromMin < lvEnd;
  });

/** 时段内重叠的预约（跨小时服务在每个经过的时段各计 1） */
const appointmentsOverlappingSlot = (
  appointments: Appointment[],
  dateStr: string,
  slot: SlotDef
): Appointment[] =>
  appointments.filter((a) => {
    if (!isActiveAppointment(a)) return false;
    const day = dayjs(a.startTime);
    if (!day.isSame(dateStr, 'day')) return false;
    const startMin = day.hour() * 60 + day.minute();
    const endMin = startMin + a.duration;
    return endMin > slot.startMin && startMin < slot.endMin;
  });

export interface SlotAnalysis {
  slot: SlotDef;
  rule: CapacityRule;
  appointments: Appointment[];
  booked: number;
  /** 超出上限的单数，0 表示未超 */
  overbooked: number;
  /** 该时段实际上岗美容师数（排班在岗且未请假） */
  staffOnDuty: number;
  /** 该时段请假的美容师 */
  staffOnLeave: Employee[];
  /** 在岗人数相对需求的缺口，0 表示够用 */
  staffShortage: number;
  status: 'ok' | 'full' | 'overbooked';
}

export interface DayCapacityInput {
  date: string;
  appointments: Appointment[];
  rules: CapacityRule[];
  employees: Employee[];
  schedules: Schedule[];
  leaves: LeaveRecord[];
}

export interface DayCapacityAnalysis {
  date: string;
  slots: SlotAnalysis[];
  /** 当天所有超员时段 */
  overbookedSlots: SlotAnalysis[];
  /** 当天所有人手不足时段 */
  shortageSlots: SlotAnalysis[];
  /** 当天有效的请假记录 */
  activeLeaves: LeaveRecord[];
  /** 需要挪时间的预约（去重） */
  appointmentsToMove: Array<{
    appointment: Appointment;
    reasons: Array<
      | { type: 'leave'; employee: Employee; slot: SlotAnalysis }
      | { type: 'overbooked'; slot: SlotAnalysis }
    >;
  }>;
}

/** 对一天逐小时算账：占用 vs 上限、在岗人手 vs 需求，并标出待挪预约 */
export const analyzeDayCapacity = (input: DayCapacityInput): DayCapacityAnalysis => {
  const { date, appointments, rules, employees, schedules, leaves } = input;
  const weekday = dayjs(date).day();
  const staffEmployees = employees.filter(
    (e) =>
      STAFF_ROLES.includes(e.role) &&
      e.status === 'active' &&
      isEmployeeScheduled(e, date, OPEN_HOUR * 60, CLOSE_HOUR * 60, schedules)
  );

  const activeLeaves = leaves.filter((lv) => lv.date === date && !lv.cancelled);

  const slots: SlotAnalysis[] = SLOTS.map((slot) => {
    const rule =
      rules.find((r) => r.weekday === weekday && r.startTime === slot.startTime) ??
      ({
        weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxBookings: 4,
        requiredStaff: 2,
      } as CapacityRule);

    const overlapping = appointmentsOverlappingSlot(appointments, date, slot);
    const onLeaveEmployees = staffEmployees.filter((e) =>
      isEmployeeOnLeave(e, date, slot.startMin, slot.endMin, activeLeaves)
    );
    const staffOnDuty = staffEmployees.length - onLeaveEmployees.length;

    const overbooked = Math.max(0, overlapping.length - rule.maxBookings);
    const staffShortage = Math.max(0, rule.requiredStaff - staffOnDuty);

    const status: SlotAnalysis['status'] =
      overbooked > 0 ? 'overbooked' : overlapping.length >= rule.maxBookings ? 'full' : 'ok';

    return {
      slot,
      rule,
      appointments: overlapping,
      booked: overlapping.length,
      overbooked,
      staffOnDuty,
      staffOnLeave: onLeaveEmployees,
      staffShortage,
      status,
    };
  });

  // 标出待挪预约：
  // 1) 美容师请假 → 挂在该美容师名下、与请假时间重叠的预约必须挪；
  // 2) 超员时段 → 按开始时间靠后（最后排上来）优先，多出来的几单要挪。
  const moveMap = new Map<
    string,
    DayCapacityAnalysis['appointmentsToMove'][number]
  >();

  const ensureEntry = (appointment: Appointment) => {
    let entry = moveMap.get(appointment.id);
    if (!entry) {
      entry = { appointment, reasons: [] };
      moveMap.set(appointment.id, entry);
    }
    return entry;
  };

  activeLeaves.forEach((lv) => {
    const employee = employees.find((e) => e.id === lv.employeeId);
    if (!employee) return;
    const lvStart = hhmmToMin(lv.startTime);
    const lvEnd = hhmmToMin(lv.endTime);
    appointments
      .filter(
        (a) =>
          a.employeeId === lv.employeeId &&
          isActiveAppointment(a) &&
          dayjs(a.startTime).isSame(date, 'day')
      )
      .forEach((a) => {
        const aStart = dayjs(a.startTime);
        const startMin = aStart.hour() * 60 + aStart.minute();
        const endMin = startMin + a.duration;
        if (endMin > lvStart && startMin < lvEnd) {
          const slot = slots.find(
            (s) => endMin > s.slot.startMin && startMin < s.slot.endMin
          );
          if (slot) {
            ensureEntry(a).reasons.push({ type: 'leave', employee, slot });
          }
        }
      });
  });

  slots
    .filter((s) => s.overbooked > 0)
    .forEach((s) => {
      // 最后排上来的先挪：开始时间降序；已经因请假要挪的单也算在超额内
      const sorted = [...s.appointments].sort((a, b) => {
        const t = new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
        return t !== 0 ? t : b.id.localeCompare(a.id);
      });
      sorted.slice(0, s.overbooked).forEach((a) => {
        ensureEntry(a).reasons.push({ type: 'overbooked', slot: s });
      });
    });

  const appointmentsToMove = Array.from(moveMap.values()).sort(
    (x, y) =>
      new Date(x.appointment.startTime).getTime() -
      new Date(y.appointment.startTime).getTime()
  );

  return {
    date,
    slots,
    overbookedSlots: slots.filter((s) => s.overbooked > 0),
    shortageSlots: slots.filter((s) => s.staffShortage > 0),
    activeLeaves,
    appointmentsToMove,
  };
};

/** 某顾客累计被改约次数 */
export const getCustomerRescheduleCount = (
  notifications: RescheduleNotification[],
  customerId: string
): number => notifications.filter((n) => n.customerId === customerId).length;

/** 某预约最近一次被挪到的时间（用于预约列表角标） */
export const getAppointmentRescheduleCount = (
  notifications: RescheduleNotification[],
  appointmentId: string
): number => notifications.filter((n) => n.appointmentId === appointmentId).length;

/**
 * 校验某时间点排一单是否可行：返回受影响的超员/人手/请假信息。
 * 供新增预约时预警使用。
 */
export const checkBooking = (
  date: string,
  startMin: number,
  duration: number,
  employeeId: string | null,
  ctx: Omit<DayCapacityInput, 'date'>
): { slotOverbooked: boolean; employeeOnLeave: boolean; slotInfo?: SlotAnalysis } => {
  const analysis = analyzeDayCapacity({ ...ctx, date });
  const endMin = startMin + duration;
  const touched = analysis.slots.filter(
    (s) => endMin > s.slot.startMin && startMin < s.slot.endMin
  );
  const slotOverbooked = touched.some((s) => s.booked >= s.rule.maxBookings);
  const employeeOnLeave = employeeId
    ? touched.some((s) => s.staffOnLeave.some((e) => e.id === employeeId))
    : false;
  return { slotOverbooked, employeeOnLeave, slotInfo: touched[0] };
};
