import { configureStore, createSlice, PayloadAction, combineReducers } from '@reduxjs/toolkit';
import { storage } from '../utils/storage';
import type {
  Customer,
  SkinAnalysis,
  Allergy,
  Membership,
  Service,
  Package,
  PackageItem,
  Employee,
  Appointment,
  ServiceRecord,
  Schedule,
  Review,
  Attendance,
  Commission,
  WaitList,
  CapacityRule,
  LeaveRecord,
  RescheduleNotification
} from '../types';
import {
  mockCustomers,
  mockSkinAnalyses,
  mockAllergies,
  mockMemberships,
  mockServices,
  mockPackages,
  mockPackageItems,
  mockEmployees,
  mockAppointments,
  mockFutureAppointments,
  mockServiceRecords,
  mockSchedules,
  mockReviews,
  mockAttendance,
  mockCommissions,
  mockWaitList,
  mockCapacityRules,
  mockLeaveRecords,
  mockRescheduleNotifications,
  mockDemoScheduleOverrides
} from '../mock';

/** 用演示排班覆盖随机排班中同一员工同一天的记录 */
const applyScheduleOverrides = (schedules: import('../types').Schedule[]): import('../types').Schedule[] => {
  const overrides = mockDemoScheduleOverrides();
  const overrideKeys = new Set(overrides.map((o) => `${o.employeeId}@${o.date}`));
  return [
    ...schedules.filter((s) => !overrideKeys.has(`${s.employeeId}@${s.date}`)),
    ...overrides,
  ];
};

interface AppState {
  customers: Customer[];
  skinAnalyses: SkinAnalysis[];
  allergies: Allergy[];
  memberships: Membership[];
  services: Service[];
  packages: Package[];
  packageItems: PackageItem[];
  employees: Employee[];
  appointments: Appointment[];
  serviceRecords: ServiceRecord[];
  schedules: Schedule[];
  reviews: Review[];
  attendance: Attendance[];
  commissions: Commission[];
  waitList: WaitList[];
  capacityRules: CapacityRule[];
  leaveRecords: LeaveRecord[];
  notifications: RescheduleNotification[];
  initialized: boolean;
}

const STORAGE_KEY = 'app_state';

const createFreshState = (): AppState => {
  const customers = mockCustomers();
  const customerIds = customers.map(c => c.id);
  const services = mockServices() as Service[];
  const serviceIds = services.map(s => s.id);
  const employees = mockEmployees() as Employee[];
  const employeeIds = employees.map(e => e.id);
  const packages = mockPackages() as Package[];

  return {
    customers,
    skinAnalyses: mockSkinAnalyses(customerIds),
    allergies: mockAllergies(customerIds),
    memberships: mockMemberships(customerIds),
    services,
    packages,
    packageItems: mockPackageItems(packages),
    employees,
    appointments: [
      ...mockAppointments(customerIds, serviceIds, employeeIds),
      ...mockFutureAppointments(customerIds, serviceIds, employeeIds)
    ],
    serviceRecords: mockServiceRecords(customerIds, serviceIds, employeeIds),
    schedules: applyScheduleOverrides(mockSchedules(employeeIds)),
    reviews: mockReviews(customerIds, employeeIds, serviceIds),
    attendance: mockAttendance(employeeIds),
    commissions: mockCommissions(employeeIds),
    waitList: mockWaitList(customerIds, serviceIds),
    capacityRules: mockCapacityRules(),
    leaveRecords: mockLeaveRecords(),
    notifications: mockRescheduleNotifications(customerIds),
    initialized: true
  };
};

const loadState = (): AppState => {
  try {
    const saved = storage.get<AppState>(STORAGE_KEY);
    if (saved && saved.initialized) {
      // Verify data integrity
      const firstCustomer = saved.customers[0];
      if (firstCustomer && firstCustomer.avatar && firstCustomer.avatar.includes('data:image/svg+xml;base64,')) {
        const b64 = firstCustomer.avatar.replace('data:image/svg+xml;base64,', '');
        try {
          atob(b64);
          // 兼容旧版本缓存：补齐容量/请假/通知等新字段
          if (!saved.capacityRules || !saved.leaveRecords || !saved.notifications) {
            const fresh = createFreshState();
            saved.capacityRules = saved.capacityRules || fresh.capacityRules;
            saved.leaveRecords = saved.leaveRecords || fresh.leaveRecords;
            saved.notifications = saved.notifications || fresh.notifications;
            saved.schedules = applyScheduleOverrides(saved.schedules);
            // 旧缓存里没有"未来演示预约"，补上便于演示对账挪单
            const hasFutureDemo = saved.appointments.some(a => a.id.startsWith('AF'));
            if (!hasFutureDemo) {
              const customerIds = saved.customers.map(c => c.id);
              const serviceIds = saved.services.map(s => s.id);
              const employeeIds = saved.employees.map(e => e.id);
              saved.appointments = [
                ...saved.appointments,
                ...mockFutureAppointments(customerIds, serviceIds, employeeIds)
              ];
            }
            saveState(saved);
          }
          return saved;
        } catch (e) {
          console.log('Detected corrupted data, regenerating...');
          storage.clear();
        }
      }
    }
  } catch (e) {
    console.log('Loading fresh data...');
  }

  return createFreshState();
};

const initialState: AppState = loadState();

const saveState = (state: AppState) => {
  storage.set(STORAGE_KEY, state);
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    addCustomer: (state, action: PayloadAction<Customer>) => {
      state.customers.unshift(action.payload);
      saveState(state);
    },
    updateCustomer: (state, action: PayloadAction<Customer>) => {
      const index = state.customers.findIndex(c => c.id === action.payload.id);
      if (index !== -1) {
        state.customers[index] = action.payload;
        saveState(state);
      }
    },
    deleteCustomer: (state, action: PayloadAction<string>) => {
      state.customers = state.customers.filter(c => c.id !== action.payload);
      saveState(state);
    },
    addSkinAnalysis: (state, action: PayloadAction<SkinAnalysis>) => {
      state.skinAnalyses.unshift(action.payload);
      saveState(state);
    },
    addAllergy: (state, action: PayloadAction<Allergy>) => {
      state.allergies.unshift(action.payload);
      saveState(state);
    },
    updateAllergy: (state, action: PayloadAction<Allergy>) => {
      const index = state.allergies.findIndex(a => a.id === action.payload.id);
      if (index !== -1) {
        state.allergies[index] = action.payload;
        saveState(state);
      }
    },
    deleteAllergy: (state, action: PayloadAction<string>) => {
      state.allergies = state.allergies.filter(a => a.id !== action.payload);
      saveState(state);
    },
    addService: (state, action: PayloadAction<Service>) => {
      state.services.unshift(action.payload);
      saveState(state);
    },
    updateService: (state, action: PayloadAction<Service>) => {
      const index = state.services.findIndex(s => s.id === action.payload.id);
      if (index !== -1) {
        state.services[index] = action.payload;
        saveState(state);
      }
    },
    deleteService: (state, action: PayloadAction<string>) => {
      state.services = state.services.filter(s => s.id !== action.payload);
      saveState(state);
    },
    addPackage: (state, action: PayloadAction<Package>) => {
      state.packages.unshift(action.payload);
      saveState(state);
    },
    updatePackage: (state, action: PayloadAction<Package>) => {
      const index = state.packages.findIndex(p => p.id === action.payload.id);
      if (index !== -1) {
        state.packages[index] = action.payload;
        saveState(state);
      }
    },
    addAppointment: (state, action: PayloadAction<Appointment>) => {
      state.appointments.unshift(action.payload);
      saveState(state);
    },
    updateAppointment: (state, action: PayloadAction<Appointment>) => {
      const index = state.appointments.findIndex(a => a.id === action.payload.id);
      if (index !== -1) {
        state.appointments[index] = action.payload;
        saveState(state);
      }
    },
    deleteAppointment: (state, action: PayloadAction<string>) => {
      state.appointments = state.appointments.filter(a => a.id !== action.payload);
      saveState(state);
    },
    addEmployee: (state, action: PayloadAction<Employee>) => {
      state.employees.unshift(action.payload);
      saveState(state);
    },
    updateEmployee: (state, action: PayloadAction<Employee>) => {
      const index = state.employees.findIndex(e => e.id === action.payload.id);
      if (index !== -1) {
        state.employees[index] = action.payload;
        saveState(state);
      }
    },
    updateSchedule: (state, action: PayloadAction<Schedule>) => {
      const index = state.schedules.findIndex(s => s.id === action.payload.id);
      if (index !== -1) {
        state.schedules[index] = action.payload;
      } else {
        state.schedules.push(action.payload);
      }
      saveState(state);
    },
    addWaitList: (state, action: PayloadAction<WaitList>) => {
      state.waitList.unshift(action.payload);
      saveState(state);
    },
    updateWaitList: (state, action: PayloadAction<WaitList>) => {
      const index = state.waitList.findIndex(w => w.id === action.payload.id);
      if (index !== -1) {
        state.waitList[index] = action.payload;
        saveState(state);
      }
    },
    deleteWaitList: (state, action: PayloadAction<string>) => {
      state.waitList = state.waitList.filter(w => w.id !== action.payload);
      saveState(state);
    },
    addServiceRecord: (state, action: PayloadAction<ServiceRecord>) => {
      state.serviceRecords.unshift(action.payload);
      const membership = state.memberships.find(m => m.customerId === action.payload.customerId);
      if (membership) {
        membership.totalSpent += action.payload.price;
        membership.points += Math.floor(action.payload.price / 10);
        if (membership.totalSpent > 30000) membership.level = 'diamond';
        else if (membership.totalSpent > 20000) membership.level = 'platinum';
        else if (membership.totalSpent > 10000) membership.level = 'gold';
        else if (membership.totalSpent > 5000) membership.level = 'silver';
      }
      saveState(state);
    },
    saveCapacityRules: (state, action: PayloadAction<CapacityRule[]>) => {
      action.payload.forEach(rule => {
        const index = state.capacityRules.findIndex(
          r => r.weekday === rule.weekday && r.startTime === rule.startTime
        );
        if (index !== -1) {
          state.capacityRules[index] = rule;
        } else {
          state.capacityRules.push(rule);
        }
      });
      saveState(state);
    },
    addLeaveRecord: (state, action: PayloadAction<LeaveRecord>) => {
      state.leaveRecords.unshift(action.payload);
      saveState(state);
    },
    cancelLeaveRecord: (state, action: PayloadAction<string>) => {
      const leave = state.leaveRecords.find(l => l.id === action.payload);
      if (leave) {
        leave.cancelled = true;
        saveState(state);
      }
    },
    /**
     * 挪单：更新预约时间/美容师，并生成改约通知。
     * 挪过之后的时段占用由容量计算引擎按最新数据重新计算。
     */
    rescheduleAppointment: (
      state,
      action: PayloadAction<{
        appointment: Appointment;
        notification: RescheduleNotification;
      }>
    ) => {
      const { appointment, notification } = action.payload;
      const index = state.appointments.findIndex(a => a.id === appointment.id);
      if (index !== -1) {
        state.appointments[index] = appointment;
      }
      state.notifications.unshift(notification);
      saveState(state);
    },
    markNotificationRead: (state, action: PayloadAction<string>) => {
      const n = state.notifications.find(item => item.id === action.payload);
      if (n) {
        n.status = 'read';
        saveState(state);
      }
    }
  }
});

export const {
  addCustomer,
  updateCustomer,
  deleteCustomer,
  addSkinAnalysis,
  addAllergy,
  updateAllergy,
  deleteAllergy,
  addService,
  updateService,
  deleteService,
  addPackage,
  updatePackage,
  addAppointment,
  updateAppointment,
  deleteAppointment,
  addEmployee,
  updateEmployee,
  updateSchedule,
  addWaitList,
  updateWaitList,
  deleteWaitList,
  addServiceRecord,
  saveCapacityRules,
  addLeaveRecord,
  cancelLeaveRecord,
  rescheduleAppointment,
  markNotificationRead
} = appSlice.actions;

export const store = configureStore({
  reducer: {
    app: appSlice.reducer
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
