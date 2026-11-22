import { NextResponse } from "next/server";
import { prisma } from "../../../../src/lib/prisma";

export const runtime = "nodejs";

// Сотрудник отвечает на вариант, который предложил менеджер
export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    const id = Number(body.id);
    const employeeId = Number(body.employeeId);
    const action = body.action;

    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(employeeId) ||
      employeeId <= 0 ||
      !["accept", "decline"].includes(action)
    ) {
      return NextResponse.json(
        { error: "Некорректные данные" },
        { status: 400 }
      );
    }

    const existing = await prisma.availabilityRequest.findUnique({
      where: { id },
    });

    if (!existing || existing.employeeId !== employeeId) {
      return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    }

    if (existing.status !== "COUNTER") {
      return NextResponse.json(
        { error: "На эту заявку нет предложения менеджера" },
        { status: 409 }
      );
    }

    const updated = await prisma.availabilityRequest.update({
      where: { id },
      data: { status: action === "accept" ? "APPROVED" : "DECLINED" },
      include: {
        employee: {
          select: { id: true, name: true, username: true },
        },
        days: true,
      },
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error) {
    console.error("REQUEST_RESPOND_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось отправить ответ" },
      { status: 500 }
    );
  }
}
