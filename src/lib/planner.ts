/*
 * Умный планировщик MAK Schedule AI.
 *
 * Идея: для каждого дня и каждых 30 минут считаем, сколько людей нужно
 * ресторану (по ожидаемым заказам и целевому джипику) и на каких позициях.
 * Затем расставляем сотрудников так, чтобы закрыть самые большие «дыры»,
 * не нарушая постоянную доступность, подтверждённые заявки и правила смен.
 */

// ===== НАСТРОЙКИ, КОТОРЫЕ МОЖНО МЕНЯТЬ =====

// Целевой джипик (GCPH) ресторана за день: заказов на один час работы
// персонала. По дашборду ресторана идеал — 6,2.
export const TARGET_GPIK = 6.2;

// Предел джипика в отдельный час. Если на одного работника приходится
// больше заказов, скорость выдачи (R2P) и доставки (sDLV) заметно падает:
// на дашборде часы с джипиком выше ~9,5 почти все с плохим R2P.
// Значение 8,5 подобрано так, чтобы на дне с дашборда за день выходило ~6,2.
export const MAX_HOURLY_GPIK = 8.5;

// Минимум людей в любой открытый час (даже когда заказов почти нет)
export const MIN_STAFF_PER_HOUR = 4;

// Часы персонала с 00:00 до 07:00 (уборка, подготовка, закрытие).
// Приложение их не планирует, но они входят в джипик ресторана за день.
// На дашборде это ~43,6 часа. Поставьте 0, если ночью никто не работает.
export const NIGHT_STAFF_HOURS = 43.6;

// Ожидаемое число заказов за день (1 — понедельник … 7 — воскресенье).
// ВНИМАНИЕ: пока везде стоит 1270 — это один реальный день с дашборда.
// Замените на свои цифры по дням недели (будни, пятница, суббота…).
export const DAILY_ORDERS: Record<number, number> = {
  1: 1270,
  2: 1270,
  3: 1270,
  4: 1270,
  5: 1270,
  6: 1270,
  7: 1270,
};

// Как заказы распределяются по часам с 07:00 до 23:00 (17 значений).
// Это число заказов (GC) по часам с реального дашборда.
export const HOURLY_WEIGHTS = [
  10, 28, 38, 39, 57, 93, 130, 138, 120, 129, 101, 113, 83, 59, 61, 52, 19,
];

// Группы позиций: какие навыки к какой группе относятся и какая доля
// людей на смене обычно нужна на этой позиции.
export type GroupId = "cashier" | "assembly" | "kitchen" | "hall";

export const GROUPS: {
  id: GroupId;
  label: string;
  skills: string[];
  share: number;
}[] = [
  {
    id: "cashier",
    label: "Касса",
    skills: ["Касса", "Работник кассовой комнаты", "Закрытие доставок"],
    share: 0.25,
  },
  {
    id: "assembly",
    label: "Выдача",
    skills: ["Выдача", "Прилавок"],
    share: 0.2,
  },
  {
    id: "kitchen",
    label: "Кухня",
    skills: ["Кухня", "Фритюр", "Гриль", "Линия"],
    share: 0.4,
  },
  {
    id: "hall",
    label: "Зал",
    skills: ["Зал", "Напитки", "Пополнение"],
    share: 0.15,
  },
];

// ===== ПРАВИЛА СМЕН =====

export const OPEN_MIN = 7 * 60; // 07:00
export const CLOSE_MIN = 24 * 60; // 00:00
const SLOT_MIN = 30;
export const SLOT_COUNT = (CLOSE_MIN - OPEN_MIN) / SLOT_MIN; // 34
const MIN_SHIFT_SLOTS = 6; // 3 часа
const MAX_SHIFT_SLOTS = 24; // 12 часов
const MINOR_MAX_SLOTS = 16; // 8 часов
const MINOR_END_MIN = 22 * 60;
const MAX_STREAK = 6; // не больше 6 рабочих дней подряд
const MAX_DAYS_OFF_IN_ROW = 5;

const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const CORE_WEIGHT = 1.2;
const OVERSTAFF_PENALTY = 0.6;
const FAIRNESS_PER_HOUR = 0.02;
const MIN_USEFUL_SCORE = 1;

// ===== ОБЩИЕ ФУНКЦИИ =====

export function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function toTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function getBreakMinutes(durationMinutes: number) {
  if (durationMinutes < 5.5 * 60) return 30;
  if (durationMinutes < 7.5 * 60) return 45;
  return 60;
}

function slotStart(slot: number) {
  return OPEN_MIN + slot * SLOT_MIN;
}

export function groupOfSkill(skill: string): GroupId | null {
  const group = GROUPS.find((item) => item.skills.includes(skill));
  return group ? group.id : null;
}

function emptyByGroup<T>(make: () => T): Record<GroupId, T> {
  return {
    cashier: make(),
    assembly: make(),
    kitchen: make(),
    hall: make(),
  };
}

// Сколько заказов ожидается в конкретный час (индекс 0 — это 07:00)
export function ordersInHour(dayOfWeek: number, hourIndex: number) {
  const total = DAILY_ORDERS[dayOfWeek] ?? 0;
  const weightSum = HOURLY_WEIGHTS.reduce((sum, value) => sum + value, 0);

  return (total * (HOURLY_WEIGHTS[hourIndex] ?? 0)) / weightSum;
}

// Как N человек делятся по позициям. Если людей двое и больше,
// обязательно есть кассир и кухня.
function allocate(total: number): Record<GroupId, number> {
  const result = emptyByGroup(() => 0);

  if (total <= 0) return result;

  if (total === 1) {
    result.cashier = 1;
    return result;
  }

  result.cashier = 1;
  result.kitchen = 1;

  let rest = total - 2;

  while (rest > 0) {
    let bestGroup = GROUPS[0];
    let bestGap = -Infinity;

    for (const group of GROUPS) {
      const gap = group.share * total - result[group.id];

      if (gap > bestGap) {
        bestGap = gap;
        bestGroup = group;
      }
    }

    result[bestGroup.id] += 1;
    rest -= 1;
  }

  return result;
}

// Сколько человек нужно на каждой позиции в каждые 30 минут
export function buildNeed(dayOfWeek: number) {
  const need = emptyByGroup(() => new Array<number>(SLOT_COUNT).fill(0));

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const hourIndex = Math.floor(slot / 2);
    const orders = ordersInHour(dayOfWeek, hourIndex);
    const total =
      orders > 0
        ? Math.max(MIN_STAFF_PER_HOUR, Math.ceil(orders / MAX_HOURLY_GPIK))
        : 0;
    const split = allocate(total);

    for (const group of GROUPS) {
      need[group.id][slot] = split[group.id];
    }
  }

  return need;
}

// ===== ПЛАНИРОВАНИЕ =====

export type PlannerEmployee = {
  id: number;
  name: string;
  isMinor: boolean;
  skills: string[];
  // Окно, когда можно работать, для каждого из 7 дней (минуты от полуночи).
  // null — в этот день работать нельзя.
  windows: ({ start: number; end: number } | null)[];
  // Сколько рабочих дней подряд было перед началом недели
  prevStreak: number;
};

export type PlannedShift = {
  employeeId: number;
  dayIndex: number;
  startTime: string;
  endTime: string;
  breakMins: number;
  roleName: string;
};

export function planWeek(employees: PlannerEmployee[]): {
  shifts: PlannedShift[];
  warnings: string[];
} {
  const shifts: PlannedShift[] = [];
  const warnings: string[] = [];

  const streak = new Map<number, number>();
  const hoursSoFar = new Map<number, number>();
  const groupsOf = new Map<number, GroupId[]>();
  const worked = new Map<number, boolean[]>();

  for (const employee of employees) {
    streak.set(employee.id, employee.prevStreak);
    hoursSoFar.set(employee.id, 0);
    worked.set(employee.id, new Array<boolean>(7).fill(false));

    const groups = new Set<GroupId>();
    for (const skill of employee.skills) {
      const group = groupOfSkill(skill);
      if (group) groups.add(group);
    }
    groupsOf.set(employee.id, Array.from(groups));

    if (groups.size === 0) {
      warnings.push(`${employee.name}: не указаны обученные позиции`);
    }
  }

  const roleUse = new Map<string, number>();

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const need = buildNeed(dayIndex + 1);
    const assigned = emptyByGroup(() => new Array<number>(SLOT_COUNT).fill(0));

    type Limits = { startSlot: number; endSlot: number; maxLen: number };
    const remaining = new Map<number, Limits>();

    for (const employee of employees) {
      const window = employee.windows[dayIndex];
      const groups = groupsOf.get(employee.id) ?? [];

      if (!window || groups.length === 0) continue;

      if ((streak.get(employee.id) ?? 0) >= MAX_STREAK) {
        warnings.push(
          `${employee.name}: ${DAY_SHORT[dayIndex]} — выходной после 6 рабочих дней подряд`
        );
        continue;
      }

      let endMin = Math.min(window.end, CLOSE_MIN);
      if (employee.isMinor) endMin = Math.min(endMin, MINOR_END_MIN);

      const startSlot = Math.ceil(
        (Math.max(window.start, OPEN_MIN) - OPEN_MIN) / SLOT_MIN
      );
      const endSlot = Math.floor((endMin - OPEN_MIN) / SLOT_MIN);

      if (endSlot - startSlot < MIN_SHIFT_SLOTS) {
        warnings.push(
          `${employee.name}: нет подходящей смены на ${DAY_SHORT[dayIndex]}`
        );
        continue;
      }

      remaining.set(employee.id, {
        startSlot,
        endSlot,
        maxLen: employee.isMinor ? MINOR_MAX_SLOTS : MAX_SHIFT_SLOTS,
      });
    }

    const scheduledToday = new Set<number>();

    while (remaining.size > 0) {
      let best: {
        employeeId: number;
        group: GroupId;
        start: number;
        end: number;
        score: number;
      } | null = null;

      for (const [employeeId, limits] of remaining) {
        const groups = groupsOf.get(employeeId) ?? [];
        const fairness =
          (hoursSoFar.get(employeeId) ?? 0) * FAIRNESS_PER_HOUR;

        for (const group of groups) {
          // Префиксные суммы «пользы» каждого получаса для этой позиции
          const prefix = new Array<number>(SLOT_COUNT + 1).fill(0);

          for (let slot = 0; slot < SLOT_COUNT; slot++) {
            const deficit = need[group][slot] - assigned[group][slot];
            const core = group === "cashier" || group === "kitchen";
            const value =
              deficit > 0 ? (core ? CORE_WEIGHT : 1) : -OVERSTAFF_PENALTY;

            prefix[slot + 1] = prefix[slot] + value;
          }

          for (
            let start = limits.startSlot;
            start + MIN_SHIFT_SLOTS <= limits.endSlot;
            start++
          ) {
            const maxEnd = Math.min(limits.endSlot, start + limits.maxLen);

            for (let end = start + MIN_SHIFT_SLOTS; end <= maxEnd; end++) {
              const score = prefix[end] - prefix[start] - fairness;

              if (!best || score > best.score) {
                best = { employeeId, group, start, end, score };
              }
            }
          }
        }
      }

      if (!best || best.score < MIN_USEFUL_SCORE) break;

      const employee = employees.find((item) => item.id === best!.employeeId)!;

      for (let slot = best.start; slot < best.end; slot++) {
        assigned[best.group][slot] += 1;
      }

      // Конкретная позиция внутри группы: берём ту, что реже использовалась
      const groupDef = GROUPS.find((item) => item.id === best!.group)!;
      const ownSkills = employee.skills.filter((skill) =>
        groupDef.skills.includes(skill)
      );
      ownSkills.sort(
        (a, b) =>
          (roleUse.get(`${dayIndex}:${a}`) ?? 0) -
          (roleUse.get(`${dayIndex}:${b}`) ?? 0)
      );
      const roleName = ownSkills[0] ?? groupDef.label;
      roleUse.set(
        `${dayIndex}:${roleName}`,
        (roleUse.get(`${dayIndex}:${roleName}`) ?? 0) + 1
      );

      const startMin = slotStart(best.start);
      const endMin = slotStart(best.end);

      shifts.push({
        employeeId: employee.id,
        dayIndex,
        startTime: toTime(startMin),
        endTime: toTime(endMin),
        breakMins: getBreakMinutes(endMin - startMin),
        roleName,
      });

      hoursSoFar.set(
        employee.id,
        (hoursSoFar.get(employee.id) ?? 0) + (endMin - startMin) / 60
      );
      scheduledToday.add(employee.id);
      worked.get(employee.id)![dayIndex] = true;
      remaining.delete(employee.id);
    }

    for (const employee of employees) {
      streak.set(
        employee.id,
        scheduledToday.has(employee.id)
          ? (streak.get(employee.id) ?? 0) + 1
          : 0
      );
    }
  }

  // Проверка: не больше 5 выходных подряд у тех, кто вообще работает
  for (const employee of employees) {
    const days = worked.get(employee.id) ?? [];
    if (!days.some(Boolean)) continue;

    let run = 0;
    let maxRun = 0;

    for (const didWork of days) {
      run = didWork ? 0 : run + 1;
      maxRun = Math.max(maxRun, run);
    }

    if (maxRun > MAX_DAYS_OFF_IN_ROW) {
      warnings.push(`${employee.name}: больше 5 выходных подряд`);
    }
  }

  return { shifts, warnings };
}

// ===== АНАЛИЗ ГОТОВОГО РАСПИСАНИЯ =====

export type DayAnalysis = {
  dayIndex: number;
  date: string;
  orders: number;
  shifts: number;
  staffHours: number;
  avgGpik: number | null;
  peakGpik: number | null;
  understaffedHours: number;
  issues: string[];
};

export type WeekAnalysis = {
  days: DayAnalysis[];
  avgGpik: number | null;
};

function describeRanges(slots: boolean[], label: string) {
  const ranges: string[] = [];
  let from = -1;

  for (let slot = 0; slot <= slots.length; slot++) {
    const on = slot < slots.length && slots[slot];

    if (on && from === -1) from = slot;

    if (!on && from !== -1) {
      ranges.push(`${toTime(slotStart(from))}–${toTime(slotStart(slot))}`);
      from = -1;
    }
  }

  if (ranges.length === 0) return null;

  const shown = ranges.slice(0, 3).join(", ");
  return `${label}: ${shown}${ranges.length > 3 ? "…" : ""}`;
}

export function analyzeWeek(
  shifts: {
    date: string | Date;
    startTime: string;
    endTime: string;
    roleName: string;
  }[],
  weekStart: Date
): WeekAnalysis {
  const days: DayAnalysis[] = [];
  let totalOrders = 0;
  let totalStaffHours = 0;

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const date = new Date(weekStart);
    date.setUTCDate(date.getUTCDate() + dayIndex);
    const dateKey = date.toISOString().slice(0, 10);

    const dayShifts = shifts.filter(
      (shift) => String(shift.date).slice(0, 10) === dateKey
    );

    const need = buildNeed(dayIndex + 1);
    const staff = emptyByGroup(() => new Array<number>(SLOT_COUNT).fill(0));
    const staffTotal = new Array<number>(SLOT_COUNT).fill(0);

    for (const shift of dayShifts) {
      const group = groupOfSkill(shift.roleName);
      const startMin = toMinutes(shift.startTime);
      const endMin = toMinutes(shift.endTime);

      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        const from = slotStart(slot);

        if (startMin <= from && endMin >= from + SLOT_MIN) {
          staffTotal[slot] += 1;
          if (group) staff[group][slot] += 1;
        }
      }
    }

    const dayOrders = DAILY_ORDERS[dayIndex + 1] ?? 0;
    const staffSlots = staffTotal.reduce((sum, value) => sum + value, 0);
    const staffHours = staffSlots / 2;

    let peak = 0;
    const noOne = new Array<boolean>(SLOT_COUNT).fill(false);
    const noKitchen = new Array<boolean>(SLOT_COUNT).fill(false);
    const noCashier = new Array<boolean>(SLOT_COUNT).fill(false);
    const understaffed = new Array<boolean>(SLOT_COUNT).fill(false);

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const orders = ordersInHour(dayIndex + 1, Math.floor(slot / 2));
      const needTotal = GROUPS.reduce(
        (sum, group) => sum + need[group.id][slot],
        0
      );

      if (orders > 0 && staffTotal[slot] === 0) {
        noOne[slot] = true;
      } else if (staffTotal[slot] > 0) {
        peak = Math.max(peak, orders / staffTotal[slot]);
      }

      if (staffTotal[slot] > 0 && staffTotal[slot] < needTotal) {
        understaffed[slot] = true;
      }

      if (staffTotal[slot] > 0 && need.kitchen[slot] > 0 && staff.kitchen[slot] === 0) {
        noKitchen[slot] = true;
      }

      if (staffTotal[slot] > 0 && need.cashier[slot] > 0 && staff.cashier[slot] === 0) {
        noCashier[slot] = true;
      }
    }

    const issues: string[] = [];

    if (dayShifts.length === 0) {
      issues.push("На этот день смен нет");
    } else {
      for (const issue of [
        describeRanges(noOne, "Никого нет на смене"),
        describeRanges(noKitchen, "Нет работника кухни"),
        describeRanges(noCashier, "Нет кассира"),
        describeRanges(understaffed, "Не хватает людей"),
      ]) {
        if (issue) issues.push(issue);
      }
    }

    // Джипик как на дашборде: заказы за день делим на часы персонала
    // (вместе с ночными часами, которые приложение не планирует).
    if (dayShifts.length > 0 && staffHours > 0) {
      totalOrders += dayOrders;
      totalStaffHours += staffHours + NIGHT_STAFF_HOURS;
    }

    days.push({
      dayIndex,
      date: dateKey,
      orders: dayOrders,
      shifts: dayShifts.length,
      staffHours,
      avgGpik:
        staffHours > 0 ? dayOrders / (staffHours + NIGHT_STAFF_HOURS) : null,
      peakGpik: staffHours > 0 ? peak : null,
      understaffedHours: understaffed.filter(Boolean).length / 2,
      issues,
    });
  }

  return {
    days,
    avgGpik: totalStaffHours > 0 ? totalOrders / totalStaffHours : null,
  };
}
