import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

const byName = (username: string) => ({
  username: { equals: username.trim(), mode: "insensitive" as const },
});

// Смена своего пароля: логин + старый пароль + новый пароль
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const newPassword = String(body.newPassword ?? "");

    if (newPassword.length < 4) {
      return NextResponse.json({ error: "Новый пароль: минимум 4 символа" }, { status: 400 });
    }

    const user = await prisma.employee.findFirst({ where: byName(String(body.username ?? "")) });

    if (!user || user.password !== String(body.oldPassword ?? "")) {
      return NextResponse.json({ error: "Старый пароль введён неверно" }, { status: 401 });
    }

    await prisma.employee.update({ where: { id: user.id }, data: { password: newPassword } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PASSWORD_CHANGE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сменить пароль" }, { status: 500 });
  }
}

// «Забыли пароль»: менеджер задаёт сотруднику новый пароль
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const newPassword = String(body.newPassword ?? "");
    const employeeId = Number(body.employeeId);

    if (newPassword.length < 4 || !Number.isInteger(employeeId)) {
      return NextResponse.json({ error: "Нужен сотрудник и пароль от 4 символов" }, { status: 400 });
    }

    const manager = await prisma.employee.findFirst({ where: byName(String(body.managerUsername ?? "")) });

    if (!manager || manager.role !== "MANAGER" || manager.password !== String(body.managerPassword ?? "")) {
      return NextResponse.json({ error: "Нет прав менеджера" }, { status: 403 });
    }

    await prisma.employee.update({ where: { id: employeeId }, data: { password: newPassword } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PASSWORD_RESET_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сбросить пароль" }, { status: 500 });
  }
}
