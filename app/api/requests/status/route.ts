
import { NextResponse } from "next/server";
import { prisma } from "../../../../src/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    const id = Number(body.id);
    const status = body.status;

    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !["APPROVED", "REJECTED"].includes(status)
    ) {
      return NextResponse.json(
        { error: "Некорректные данные" },
        { status: 400 }
      );
    }

    const existingRequest = await prisma.availabilityRequest.findUnique({
      where: { id },
    });

    if (!existingRequest) {
      return NextResponse.json(
        { error: "Заявка не найдена" },
        { status: 404 }
      );
    }

    if (existingRequest.status !== "PENDING") {
      return NextResponse.json(
        { error: "Эта заявка уже рассмотрена" },
        { status: 409 }
      );
    }

    const updatedRequest = await prisma.availabilityRequest.update({
      where: { id },
      data: {
        status,
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

    return NextResponse.json({
      success: true,
      request: updatedRequest,
    });
  } catch (error) {
    console.error("REQUEST_STATUS_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось изменить статус заявки" },
      { status: 500 }
    );
  }
}
