import { NextResponse } from "next/server";
import { prisma } from "../../../../src/lib/prisma";
import {
  planWeek,
  toMinutes,
  type PlannerEmployee,
} from "../../../../src/lib/planner";

export const runtime = "nodejs";

const DAY_NAMES = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

function getMonday(value: Date) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);

  const day = date.getUTCDay();
  const difference = day === 0 ? -6 : 1 - day;

  date.setUTCDate(date.getUTCDate() + difference);
  return date;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const requestedDate = body.weekStart
      ? new Date(`${String(body.weekStart).slice(0, 10)}T00:00:00.000Z`)
      : new Date();

    if (Number.isNaN(requestedDate.getTime())) {
      return NextResponse.json(
        { error: "Указана неправильная дата" },
        { status: 400 }
      );
    }

    const weekStart = getMonday(requestedDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const prevStart = new Date(weekStart);
    prevStart.setUTCDate(prevStart.getUTCDate() - 7);

    const employees = await prisma.employee.findMany({
      where: { role: "EMPLOYEE" },
      include: {
        availabilities: true,
        skills: {
          include: { skill: true },
        },
        requests: {
          where: {
            status: "APPROVED",
            weekStart: {
              gte: weekStart,
              lt: weekEnd,
            },
          },
          orderBy: { createdAt: "desc" },
          include: { days: true },
        },
      },
    });

    // Смены прошлой недели нужны, чтобы считать рабочие дни подряд
    const previousShifts = await prisma.shift.findMany({
      where: { date: { gte: prevStart, lt: weekStart } },
      select: { employeeId: true, date: true },
    });

    const warnings: string[] = [];

    const plannerEmployees: PlannerEmployee[] = employees.map((employee) => {
      const windows: PlannerEmployee["windows"] = [];

      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayOfWeek = dayIndex + 1;

        const availability = employee.availabilities.find(
          (item) => item.dayOfWeek === dayOfWeek
        );

        const approvedRequest = employee.requests.find((item) =>
          item.days.some((day) => day.dayOfWeek === dayOfWeek)
        );

        const dayChange = approvedRequest?.days.find(
          (day) => day.dayOfWeek === dayOfWeek
        );

        if (dayChange?.mode === "OFF") {
          windows.push(null);
          continue;
        }

        // Без подтверждённой замены времени работаем только в дни
        // постоянной доступности. С заменой можно выйти и в обычный выходной.
        if (
          dayChange?.mode !== "TIME" &&
          (!availability || availability.isOff)
        ) {
          windows.push(null);
          continue;
        }

        let startTime = availability?.startTime ?? null;
        let endTime = availability?.endTime ?? null;

        if (dayChange?.mode === "TIME") {
          startTime = dayChange.startTime;
          endTime = dayChange.endTime;
        }

        if (!startTime || !endTime) {
          warnings.push(
            `${employee.name}: не указано время на ${DAY_NAMES[dayIndex]}`
          );
          windows.push(null);
          continue;
        }

        windows.push({
          start: toMinutes(startTime),
          end: toMinutes(endTime),
        });
      }

      // Сколько рабочих дней подряд было перед началом этой недели
      const workedKeys = new Set(
        previousShifts
          .filter((shift) => shift.employeeId === employee.id)
          .map((shift) => shift.date.toISOString().slice(0, 10))
      );

      let prevStreak = 0;
      const cursor = new Date(weekStart);

      for (let step = 0; step < 7; step++) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);

        if (!workedKeys.has(cursor.toISOString().slice(0, 10))) break;

        prevStreak += 1;
      }

      return {
        id: employee.id,
        name: employee.name,
        isMinor: employee.isMinor,
        skills: employee.skills.map((item) => item.skill.name),
        windows,
        prevStreak,
      };
    });

    const plan = planWeek(plannerEmployees);
    warnings.push(...plan.warnings);

    const generated = plan.shifts.map((shift) => {
      const date = new Date(weekStart);
      date.setUTCDate(date.getUTCDate() + shift.dayIndex);

      return {
        employeeId: shift.employeeId,
        date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakMins: shift.breakMins,
        roleName: shift.roleName,
      };
    });

    if (generated.length === 0) {
      return NextResponse.json(
        {
          error:
            "Не удалось создать расписание. Проверь постоянную доступность и навыки сотрудников.",
          warnings,
        },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.shift.deleteMany({
        where: {
          date: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
      });

      await tx.shift.createMany({
        data: generated,
      });

      return tx.shift.findMany({
        where: {
          date: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
        include: {
          employee: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      });
    });

    return NextResponse.json({
      success: true,
      message: `Создано смен: ${result.length}`,
      shifts: result,
      warnings,
    });
  } catch (error) {
    console.error("SCHEDULE_GENERATE_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось создать расписание" },
      { status: 500 }
    );
  }
}
