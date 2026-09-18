export interface Customer {
  id: string;
  name: string;
  phone: string;
  birthday: string;
  gender: 'male' | 'female';
  avatar: string;
  address: string;
  skinType: string;
  notes: string;
  createdAt: string;
}

export interface SkinAnalysis {
  id: string;
  customerId: string;
  analysisDate: string;
  skinType: string;
  oiliness: string;
  moisture: string;
  elasticity: string;
  sensitivity: string;
  skinCondition: string;
  recommendations: string;
  photoUrl?: string;
}

export interface Allergy {
  id: string;
  customerId: string;
  allergen: string;
  severity: 'mild' | 'moderate' | 'severe';
  discoveredDate: string;
  notes: string;
}

export interface ServiceRecord {
  id: string;
  customerId: string;
  serviceId: string;
  employeeId: string;
  serviceDate: string;
  price: number;
  notes: string;
}

export interface Membership {
  id: string;
  customerId: string;
  level: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  points: number;
  totalSpent: number;
  joinDate: string;
  expireDate: string;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  description: string;
  suitableSkin: string[];
  effectDescription: string;
  imageUrl: string;
  status: 'active' | 'inactive';
}

export interface Package {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  validityDays: number;
  description: string;
  imageUrl: string;
  status: 'active' | 'inactive';
}

export interface PackageItem {
  id: string;
  packageId: string;
  serviceId: string;
  count: number;
}

export interface Appointment {
  id: string;
  customerId: string;
  serviceId: string;
  employeeId: string;
  startTime: string;
  endTime: string;
  duration: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  source: 'phone' | 'wechat' | 'walk_in' | 'online';
  notes: string;
  reminderSent: boolean;
}

export interface WaitList {
  id: string;
  customerId: string;
  serviceId: string;
  preferredDate: string;
  addedAt: string;
  status: 'waiting' | 'notified' | 'cancelled' | 'booked';
}

/** 时段容量规则：按星期配置模板，每个营业小时一条 */
export interface CapacityRule {
  /** 0=周日 1=周一 ... 6=周六 */
  weekday: number;
  /** 时段起点，HH:mm */
  startTime: string;
  /** 时段终点，HH:mm */
  endTime: string;
  /** 该时段最多同时接几位客人 */
  maxBookings: number;
  /** 该时段需要几位美容师在岗 */
  requiredStaff: number;
}

/** 美容师临时请假记录 */
export interface LeaveRecord {
  id: string;
  employeeId: string;
  date: string;
  /** 请假起点，HH:mm（全天请假则为 00:00） */
  startTime: string;
  /** 请假终点，HH:mm（全天请假则为 23:59） */
  endTime: string;
  reason: string;
  type: 'full_day' | 'partial';
  createdAt: string;
  /** 撤销请假后不再参与人手计算 */
  cancelled: boolean;
}

/** 改约通知：预约被挪动时通知顾客，同一顾客的累计次数可由此统计 */
export interface RescheduleNotification {
  id: string;
  appointmentId: string;
  customerId: string;
  /** 挪动前开始时间 ISO */
  fromTime: string;
  /** 挪动后开始时间 ISO */
  toTime: string;
  /** 该顾客第几次被改约（从 1 开始） */
  rescheduleCount: number;
  reason: string;
  createdAt: string;
  status: 'sent' | 'read';
}

export interface Employee {
  id: string;
  name: string;
  role: 'beautician' | 'manager' | 'receptionist' | 'technician';
  phone: string;
  avatar: string;
  hireDate: string;
  baseSalary: number;
  commissionRate: number;
  skills: string[];
  status: 'active' | 'leave' | 'terminated';
}

export interface Schedule {
  id: string;
  employeeId: string;
  date: string;
  shiftType: 'morning' | 'afternoon' | 'full_day' | 'off' | 'overtime';
  startTime: string;
  endTime: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  status: 'present' | 'absent' | 'late' | 'leave';
}

export interface Review {
  id: string;
  employeeId: string;
  customerId: string;
  rating: number;
  comment: string;
  reviewDate: string;
  serviceId: string;
}

export interface Commission {
  id: string;
  employeeId: string;
  serviceRecordId: string;
  amount: number;
  commissionDate: string;
}

export interface DashboardStats {
  monthlyRevenue: number;
  newCustomers: number;
  totalAppointments: number;
  completedServices: number;
  revenueTrend: { date: string; value: number }[];
  topEmployees: { name: string; value: number }[];
  todayAppointments: TodayAppointment[];
}

export interface TodayAppointment {
  id: string;
  customerName: string;
  customerAvatar: string;
  serviceName: string;
  employeeName: string;
  time: string;
  status: string;
}
