
import { NextResponse } from "next/server";
import { prisma } from "../../../../src/lib/prisma";

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

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function getBreakMinutes(duration: number) {
  if (duration < 5.5 * 60) return 30;
  if (duration < 7.5 * 60) return 45;
  return 60;
}

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
          include: { days: true },
        },
      },
    });

    const generated: Array<{
      employeeId: number;
      date: Date;
      startTime: string;
      endTime: string;
      breakMins: number;
      roleName: string;
    }> = [];

    const warnings: string[] = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const date = new Date(weekStart);
      date.setUTCDate(date.getUTCDate() + dayIndex);

      const dayOfWeek = dayIndex + 1;
      const roleCounts = new Map<string, number>();

      for (const employee of employees) {
        const availability = employee.availabilities.find(
          (item) => item.dayOfWeek === dayOfWeek
        );

        if (!availability || availability.isOff) continue;

        const approvedRequest = employee.requests.find((item) =>
          item.days.some((day) => day.dayOfWeek === dayOfWeek)
        );

        const dayChange = approvedRequest?.days.find(
          (day) => day.dayOfWeek === dayOfWeek
        );

        if (dayChange?.mode === "OFF") continue;

        let startTime = availability.startTime;
        let endTime = availability.endTime;

        if (dayChange?.mode === "TIME") {
          startTime = dayChange.startTime;
          endTime = dayChange.endTime;
        }

        if (!startTime || !endTime) {
          warnings.push(
            `${employee.name}: не указано время на ${DAY_NAMES[dayIndex]}`
          );
          continue;
        }

        let start = toMinutes(startTime);
        let end = toMinutes(endTime);

        // В ресторане смены планируются с 07:00 до 00:00.
        start = Math.max(start, 7 * 60);
        end = Math.min(end, 24 * 60);

        if (employee.isMinor) {
          end = Math.min(end, 22 * 60);
          end = Math.min(end, start + 8 * 60);
        }

        // Продолжительность смены — от 3 до 12 часов.
        end = Math.min(end, start + 12 * 60);

        const duration = end - start;

        if (duration < 3 * 60) {
          warnings.push(
            `${employee.name}: нет подходящей смены на ${DAY_NAMES[dayIndex]}`
          );
          continue;
        }

        const skillNames = employee.skills
          .map((item) => item.skill.name)
          .sort((a, b) => {
            return (
              (roleCounts.get(a) ?? 0) -
              (roleCounts.get(b) ?? 0)
            );
          });

        const roleName = skillNames[0];

        if (!roleName) {
          warnings.push(`${employee.name}: не указаны обученные позиции`);
          continue;
        }

        roleCounts.set(roleName, (roleCounts.get(roleName) ?? 0) + 1);

        generated.push({
          employeeId: employee.id,
          date,
          startTime: toTime(start),
          endTime: toTime(end),
          breakMins: getBreakMinutes(duration),
          roleName,
        });
      }
    }

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
