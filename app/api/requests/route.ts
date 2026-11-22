
import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

const dayNumbers: Record<string, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

// Получение заявок для менеджера
export async function GET() {
  try {
    const requests = await prisma.availabilityRequest.findMany({
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            username: true,
            skills: {
              select: {
                skill: { select: { name: true } },
              },
            },
          },
        },
        days: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("REQUEST_LIST_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось загрузить заявки" },
      { status: 500 }
    );
  }
}

// Создание заявки сотрудником
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const employeeId = Number(body.employeeId);
    const weekStartText = String(body.weekStart ?? "").trim();

    if (!Number.isInteger(employeeId) || employeeId <= 0 || !weekStartText) {
      return NextResponse.json(
        { error: "Не хватает данных для заявки" },
        { status: 400 }
      );
    }

    const weekStart = new Date(`${weekStartText}T00:00:00.000Z`);

    if (Number.isNaN(weekStart.getTime())) {
      return NextResponse.json(
        { error: "Некорректная дата недели" },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      return NextResponse.json(
        { error: "Сотрудник не найден" },
        { status: 404 }
      );
    }

    const changes = body.changes ?? {};
    const daysOff: string[] = Array.isArray(body.daysOff)
      ? body.daysOff.map(String)
      : [];

    const days = Object.entries(dayNumbers).map(([dayKey, dayOfWeek]) => {
      const change = changes[dayKey] as
        | { mode?: string; start?: string; end?: string }
        | undefined;

      const isDayOff =
        change?.mode === "off" ||
        daysOff.includes(dayKey) ||
        daysOff.includes(String(dayOfWeek));

      if (isDayOff) {
        return {
          dayOfWeek,
          mode: "OFF" as const,
          startTime: null,
          endTime: null,
        };
      }

      if (change?.mode === "time") {
        if (
          !change.start ||
          !change.end ||
          change.start >= change.end
        ) {
          throw new Error(`Проверь время работы: ${dayKey}`);
        }

        return {
          dayOfWeek,
          mode: "TIME" as const,
          startTime: change.start,
          endTime: change.end,
        };
      }

      return {
        dayOfWeek,
        mode: "SAME" as const,
        startTime: null,
        endTime: null,
      };
    });

    const existingRequest = await prisma.availabilityRequest.findFirst({
      where: {
        employeeId,
        weekStart,
        status: "PENDING",
      },
    });

    if (existingRequest) {
      return NextResponse.json(
        { error: "У тебя уже есть заявка на эту неделю, ожидающая рассмотрения" },
        { status: 409 }
      );
    }

    const createdRequest = await prisma.availabilityRequest.create({
      data: {
        employeeId,
        weekStart,
        comment:
          typeof body.comment === "string" && body.comment.trim()
            ? body.comment.trim()
            : null,
        days: {
          create: days,
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        days: true,
      },
    });

    return NextResponse.json(
      { success: true, request: createdRequest },
      { status: 201 }
    );
  } catch (error) {
    console.error("REQUEST_CREATE_ERROR:", error);

    const message = error instanceof Error ? error.message : "";

    if (message.startsWith("Проверь время работы:")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Не удалось создать заявку" },
      { status: 500 }
    );
  }
}
