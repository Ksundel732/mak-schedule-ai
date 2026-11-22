import { NextResponse } from "next/server";
import { prisma } from "../../../../src/lib/prisma";
import { joinComment, splitComment } from "../../../../src/lib/request-meta";

export const runtime = "nodejs";

type ProposedDay = {
  dayOfWeek: number;
  mode: "SAME" | "TIME" | "OFF";
  startTime: string | null;
  endTime: string | null;
};

// Менеджер предлагает свой вариант по заявке сотрудника
export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    const id = Number(body.id);
    const note = typeof body.note === "string" ? body.note : "";

    if (!Number.isInteger(id) || id <= 0 || !Array.isArray(body.days)) {
      return NextResponse.json(
        { error: "Некорректные данные" },
        { status: 400 }
      );
    }

    const days: ProposedDay[] = [];

    for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
      const item = body.days.find(
        (day: { dayOfWeek?: unknown }) => Number(day?.dayOfWeek) === dayOfWeek
      ) as
        | { mode?: string; startTime?: string; endTime?: string }
        | undefined;

      if (item?.mode === "OFF") {
        days.push({ dayOfWeek, mode: "OFF", startTime: null, endTime: null });
        continue;
      }

      if (item?.mode === "TIME") {
        if (!item.startTime || !item.endTime || item.startTime >= item.endTime) {
          return NextResponse.json(
            { error: `Проверь время работы: день ${dayOfWeek}` },
            { status: 400 }
          );
        }

        days.push({
          dayOfWeek,
          mode: "TIME",
          startTime: item.startTime,
          endTime: item.endTime,
        });
        continue;
      }

      days.push({ dayOfWeek, mode: "SAME", startTime: null, endTime: null });
    }

    const existing = await prisma.availabilityRequest.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    }

    if (existing.status !== "PENDING") {
      return NextResponse.json(
        { error: "Эта заявка уже рассмотрена" },
        { status: 409 }
      );
    }

    const employeeText = splitComment(existing.comment).text;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.availabilityRequestDay.deleteMany({ where: { requestId: id } });

      await tx.availabilityRequestDay.createMany({
        data: days.map((day) => ({ ...day, requestId: id })),
      });

      return tx.availabilityRequest.update({
        where: { id },
        data: {
          status: "COUNTER",
          comment: joinComment(employeeText, note),
        },
        include: {
          employee: {
            select: { id: true, name: true, username: true },
          },
          days: true,
        },
      });
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error) {
    console.error("REQUEST_PROPOSE_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось отправить вариант" },
      { status: 500 }
    );
  }
}
