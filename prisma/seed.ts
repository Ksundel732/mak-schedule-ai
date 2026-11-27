import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1. Сотрудники
  const employees = [
    {
      name: "Менеджер",
      username: "manager",
      password: "makadmin",
      role: "MANAGER" as const,
      isMinor: false,
    },
    {
      name: "Алина",
      username: "alina",
      password: "mak123",
      role: "EMPLOYEE" as const,
      isMinor: true,
    },
    {
      name: "Денис",
      username: "denis",
      password: "mak123",
      role: "EMPLOYEE" as const,
      isMinor: false,
    },
  ];

  for (const employee of employees) {
    await prisma.employee.upsert({
      where: { username: employee.username },
      update: {
        name: employee.name,
        role: employee.role,
        isMinor: employee.isMinor,
      },
      create: employee,
    });
  }

  // 2. Навыки
  const skillNames = [
    "Касса",
    "Выдача",
    "Прилавок",
    "Кухня",
    "Фритюр",
    "Гриль",
    "Линия",
    "Зал",
    "Напитки",
    "Пополнение",
    "Закрытие доставок",
    "Работник кассовой комнаты",
  ];

  for (const name of skillNames) {
    await prisma.skill.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 3. Связываем сотрудников с их демонстрационными навыками
  const employeeSkills: Record<string, string[]> = {
    alina: ["Касса", "Кухня", "Выдача"],
    denis: ["Кухня", "Выдача", "Зал"],
  };

  for (const [username, names] of Object.entries(employeeSkills)) {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { username },
    });

    for (const name of names) {
      const skill = await prisma.skill.findUniqueOrThrow({
        where: { name },
      });

      await prisma.employeeSkill.upsert({
        where: {
          employeeId_skillId: {
            employeeId: employee.id,
            skillId: skill.id,
          },
        },
        update: {},
        create: {
          employeeId: employee.id,
          skillId: skill.id,
        },
      });
    }
  }

  // 4. Демонстрационная постоянная доступность на всю неделю.
  // dayOfWeek: 1 — понедельник, 7 — воскресенье.
  // Для Алины и Дениса график условный, только для проверки приложения.
  const availability: Record<
    string,
    { dayOfWeek: number; isOff: boolean; startTime: string | null; endTime: string | null }[]
  > = {
    alina: [
      { dayOfWeek: 1, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 2, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 3, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 4, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 5, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 6, isOff: true, startTime: null, endTime: null },
      { dayOfWeek: 7, isOff: true, startTime: null, endTime: null },
    ],
    denis: [
      { dayOfWeek: 1, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 2, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 3, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 4, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 5, isOff: false, startTime: "17:00", endTime: "22:00" },
      { dayOfWeek: 6, isOff: true, startTime: null, endTime: null },
      { dayOfWeek: 7, isOff: true, startTime: null, endTime: null },
    ],
  };

  for (const [username, days] of Object.entries(availability)) {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { username },
    });

    for (const day of days) {
      await prisma.permanentAvailability.upsert({
        where: {
          employeeId_dayOfWeek: {
            employeeId: employee.id,
            dayOfWeek: day.dayOfWeek,
          },
        },
        update: {
          isOff: day.isOff,
          startTime: day.startTime,
          endTime: day.endTime,
        },
        create: {
          employeeId: employee.id,
          dayOfWeek: day.dayOfWeek,
          isOff: day.isOff,
          startTime: day.startTime,
          endTime: day.endTime,
        },
      });
    }
  }

  console.log("Готово! Сотрудники, навыки и постоянная доступность заполнены.");
}

main()
  .catch((error) => {
    console.error("Ошибка заполнения базы данных:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });