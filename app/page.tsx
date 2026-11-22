
"use client";

import { useEffect, useState } from "react";

type DayChange = {
  mode: "same" | "time" | "off";
  start: string;
  end: string;
};

const days = [
  { id: "mon", name: "Понедельник", short: "Пн" },
  { id: "tue", name: "Вторник", short: "Вт" },
  { id: "wed", name: "Среда", short: "Ср" },
  { id: "thu", name: "Четверг", short: "Чт" },
  { id: "fri", name: "Пятница", short: "Пт" },
  { id: "sat", name: "Суббота", short: "Сб" },
  { id: "sun", name: "Воскресенье", short: "Вс" },
];

function createInitialChanges(): Record<string, DayChange> {
  const result: Record<string, DayChange> = {};

  days.forEach((day) => {
    result[day.id] = {
      mode: "same",
      start: "17:00",
      end: "22:00",
    };
  });

  return result;
}

const requestStatusLabels: Record<string, string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Подтверждена",
  REJECTED: "Отклонена",
};

// Понедельник текущей недели (в UTC, как хранятся даты смен)
function getWeekStart(value: Date) {
  const date = new Date(
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  );
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return date;
}

// Список изменённых дней заявки: «Пятница — 18:00–22:00», «Суббота — Выходной»
function describeRequestDays(request: any) {
  if (!Array.isArray(request?.days)) return [];

  return request.days
    .filter((day: any) => day.mode !== "SAME")
    .map((day: any) => ({
      dayOfWeek: day.dayOfWeek as number,
      name: days[day.dayOfWeek - 1]?.name || `День ${day.dayOfWeek}`,
      off: day.mode === "OFF",
      text:
        day.mode === "OFF"
          ? "Выходной"
          : `${day.startTime || "?"}–${day.endTime || "?"}`,
    }));
}

export default function Home() {
  async function updateRequestStatus(
    request: any,
    status: "APPROVED" | "REJECTED"
  ) {
    try {
      const response = await fetch("/api/requests/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: request.id,
          status,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Ошибка изменения статуса:", data);
        alert(data.error || "Не удалось изменить статус заявки");
        return;
      }

      setManagerRequests((current) =>
        current.map((item) =>
          item.id === request.id ? { ...item, status } : item
        )
      );

      // После подтверждения сразу пересобираем график недели
      // с учётом одобренного изменения и показываем его.
      if (status === "APPROVED") {
        const scheduleResponse = await fetch("/api/schedule/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            weekStart: String(request.weekStart).slice(0, 10),
          }),
        });

        const scheduleData = await scheduleResponse.json();

        if (scheduleResponse.ok && Array.isArray(scheduleData.shifts)) {
          setShifts(scheduleData.shifts);
        } else {
          alert(
            scheduleData.error ||
              "Заявка подтверждена, но график обновить не удалось"
          );
        }
      }
    } catch (error) {
      console.error("UPDATE_REQUEST_STATUS_ERROR:", error);
    }
  }
  const [managerRequests, setManagerRequests] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [myShifts, setMyShifts] = useState<any[]>([]);
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [currentEmployeeName, setCurrentEmployeeName] = useState("");
  const [employees, setEmployees] = useState<any[]>([]);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const [loggedIn, setLoggedIn] = useState(false);
  const [managerLoggedIn, setManagerLoggedIn] = useState(false);

 useEffect(() => {
  if (!managerLoggedIn) return;

  async function loadManagerData() {
    try {
      console.log("Загрузка данных менеджера...");

      // Загружаем заявки
      const requestsResponse = await fetch("/api/requests", {
        method: "GET",
        cache: "no-store",
      });

      const requestsData = await requestsResponse.json();

      console.log("Ответ API заявок:", requestsData);

      if (requestsResponse.ok && Array.isArray(requestsData.requests)) {
        setManagerRequests(requestsData.requests);

        console.log(
          "Заявок загружено:",
          requestsData.requests.length
        );
      } else {
        console.error(
          "Ошибка загрузки заявок:",
          requestsData
        );

        setManagerRequests([]);
      }

      // Загружаем сотрудников
      const employeesResponse = await fetch("/api/employees", {
        method: "GET",
        cache: "no-store",
      });

      const employeesData = await employeesResponse.json();

      console.log(
        "Ответ API сотрудников:",
        employeesData
      );

      if (
        employeesResponse.ok &&
        Array.isArray(employeesData.employees)
      ) {
        setEmployees(employeesData.employees);

        console.log(
          "Сотрудников загружено:",
          employeesData.employees.length
        );
      } else {
        console.error(
          "Ошибка загрузки сотрудников:",
          employeesData
        );

        setEmployees([]);
      }
    } catch (error) {
      console.error(
        "LOAD_MANAGER_DATA_ERROR:",
        error
      );

      setManagerRequests([]);
      setEmployees([]);
    }
  }

  loadManagerData();
}, [managerLoggedIn]);

useEffect(() => {
  if (!managerLoggedIn) return;

  async function loadShifts() {
    try {
      const response = await fetch("/api/schedule", {
        cache: "no-store",
      });
      const data = await response.json();

      if (response.ok && Array.isArray(data.shifts)) {
        setShifts(data.shifts);
      } else {
        console.error("Ошибка загрузки расписания:", data);
      }
    } catch (error) {
      console.error("LOAD_SHIFTS_ERROR:", error);
    }
  }

  loadShifts();
}, [managerLoggedIn]);

useEffect(() => {
  if (!managerLoggedIn) return;

  async function loadEmployees() {
    try {
      console.log("Загрузка сотрудников...");

      const response = await fetch("/api/employees", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      console.log("Ответ API сотрудников:", data);

      if (!response.ok) {
        console.error("Ошибка API сотрудников:", data);
        return;
      }

      if (Array.isArray(data.employees)) {
        setEmployees(data.employees);

        console.log(
          "Сотрудников загружено:",
          data.employees.length
        );
      } else {
        console.error(
          "Поле employees не является массивом:",
          data.employees
        );

        setEmployees([]);
      }
    } catch (error) {
      console.error(
        "LOAD_EMPLOYEES_ERROR:",
        error
      );

      setEmployees([]);
    }
  }

  loadEmployees();
}, [managerLoggedIn]);

  const [currentEmployeeId, setCurrentEmployeeId] =
  useState<number | null>(null);
  const [showRequest, setShowRequest] = useState(false);

  const [changes, setChanges] =
    useState<Record<string, DayChange>>(
      createInitialChanges()
    );

  const [comment, setComment] = useState("");

  const [requestSent, setRequestSent] =
    useState(false);

  async function loadMyData(employeeId: number) {
    try {
      const [shiftsResponse, requestsResponse] = await Promise.all([
        fetch("/api/schedule", { cache: "no-store" }),
        fetch("/api/requests", { cache: "no-store" }),
      ]);

      const shiftsData = await shiftsResponse.json();
      const requestsData = await requestsResponse.json();

      if (shiftsResponse.ok && Array.isArray(shiftsData.shifts)) {
        const weekStart = getWeekStart(new Date());

        setMyShifts(
          shiftsData.shifts.filter(
            (shift: any) =>
              shift.employeeId === employeeId &&
              new Date(shift.date) >= weekStart
          )
        );
      }

      if (requestsResponse.ok && Array.isArray(requestsData.requests)) {
        setMyRequests(
          requestsData.requests.filter(
            (item: any) => item.employeeId === employeeId
          )
        );
      }
    } catch (error) {
      console.error("LOAD_MY_DATA_ERROR:", error);
    }
  }

  useEffect(() => {
    if (!loggedIn || !currentEmployeeId) return;

    loadMyData(currentEmployeeId);

    // Статус заявки и график обновляются сами каждые 10 секунд
    const timer = setInterval(() => loadMyData(currentEmployeeId), 10000);

    return () => clearInterval(timer);
  }, [loggedIn, currentEmployeeId]);

  async function handleLogin(e: React.FormEvent) {
  e.preventDefault();

  setError("");

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: login,
        password: password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Неверный логин или пароль");
      return;
    }

    setCurrentEmployeeName(data.employee.name || "");

    if (data.employee.role === "MANAGER") {
  setCurrentEmployeeId(data.employee.id);
  setManagerLoggedIn(true);
} else {
  setCurrentEmployeeId(data.employee.id);
  setLoggedIn(true);
}
  } catch (error) {
    console.error("LOGIN_ERROR:", error);
    setError("Не удалось подключиться к серверу");
  }
}

  function logout() {
    setLoggedIn(false);
    setManagerLoggedIn(false);
    setShowRequest(false);

    setLogin("");
    setPassword("");
  }

  function updateDay(
    dayId: string,
    field: keyof DayChange,
    value: string
  ) {
    setChanges((current) => ({
      ...current,

      [dayId]: {
        ...current[dayId],
        [field]: value,
      },
    }));
  }

 
async function submitRequest(e: React.FormEvent) {
  e.preventDefault();
  setError("");

  if (!currentEmployeeId) {
    setError("Не удалось определить сотрудника");
    return;
  }

  try {
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employeeId: currentEmployeeId,
        weekStart: new Date().toISOString().split("T")[0],
        comment,
        changes: Object.fromEntries(
          Object.entries(changes)
            .filter(([, value]) => value.mode !== "same")
            .map(([day, value]) => [
              day,
              {
                mode: value.mode,
                start: value.start,
                end: value.end,
              },
            ])
        ),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Не удалось отправить заявку");
      return;
    }

    setRequestSent(true);
    loadMyData(currentEmployeeId);
    setShowRequest(false);
    setComment("");
    setChanges(createInitialChanges());
  } catch (error) {
    console.error("REQUEST_ERROR:", error);
    setError("Не удалось подключиться к серверу");
  }
}

  function cancelRequest() {
    setShowRequest(false);

    setChanges(createInitialChanges());

    setComment("");
  }

  /*
   * ============================
   * КАБИНЕТ МЕНЕДЖЕРА
   * ============================
   */

  if (managerLoggedIn) {
    const pendingRequests = managerRequests.filter(
      (request) => request.status === "PENDING"
    );
    const sortedRequests = [
      ...pendingRequests,
      ...managerRequests.filter((request) => request.status !== "PENDING"),
    ];
    const todayDate = new Date();
    const todayKey = `${todayDate.getFullYear()}-${String(
      todayDate.getMonth() + 1
    ).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
    const shiftsToday = shifts.filter(
      (shift) => String(shift.date).slice(0, 10) === todayKey
    ).length;
    return (
      <main className="dashboard-page">

        <header className="topbar">

          <div>
            <div className="brand">
              MAK Schedule AI
            </div>

            <div className="subtitle">
              Панель менеджера
            </div>
          </div>

          <button
            className="logout-button"
            onClick={logout}
          >
            Выйти
          </button>

        </header>

        <section className="manager-welcome">

          <div>

            <h1>
  Добрый вечер! 👋
</h1>

            <p>
              Управление сотрудниками,
              заявками и расписанием ресторана.
            </p>

          </div>

        </section>

        <section className="manager-stats">

          <div className="manager-stat">

            <span>👥</span>

            <div>
              <strong>
  {employees.filter(
    (employee) => employee.role === "EMPLOYEE"
  ).length}
</strong>

              <p>
                Сотрудников
              </p>
            </div>

          </div>

          <div className="manager-stat">

            <span>📝</span>

            <div>
              <strong>
                {pendingRequests.length}
              </strong>

              <p>
                Новых заявок
              </p>
            </div>

          </div>

          <div className="manager-stat">

            <span>📅</span>

            <div>
              <strong>{shiftsToday}</strong>

              <p>
                Смен сегодня
              </p>
            </div>

          </div>

          <div className="manager-stat">

            <span>🤖</span>

            <div>
              <strong>6.1</strong>

              <p>
                Средний джипик
              </p>
            </div>

          </div>

        </section>

        <section className="manager-content">

          <div className="manager-card">

            <div className="manager-card-header">

              <div>

                <h2>
                  Заявки на эту неделю
                </h2>

                <p>
                  Изменения доступности
                  сотрудников
                </p>

              </div>

              <span className="counter">
                {pendingRequests.length}
              </span>

            </div>

            {sortedRequests.length === 0 ? (
              <div
                style={{
                  padding: "28px",
                  textAlign: "center",
                  color: "#718078",
                  background: "#fbfdfc",
                  border: "1px dashed #d5e4db",
                  borderRadius: "12px",
                }}
              >
                Новых заявок нет
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {sortedRequests.map((request) => {
                  const employeeName =
                    request.employee?.name || `ID ${request.employeeId}`;
                  const skillNames: string[] = Array.isArray(
                    request.employee?.skills
                  )
                    ? request.employee.skills
                        .map((item: any) => item.skill?.name)
                        .filter(Boolean)
                    : [];
                  const changedDays = describeRequestDays(request);

                  return (
                    <div className="request-manager" key={request.id}>

                      <div className="request-person">

                        <div className="small-avatar">
                          {employeeName.charAt(0).toUpperCase()}
                        </div>

                        <div>
                          <strong>{employeeName}</strong>
                          <span>
                            {skillNames.length > 0
                              ? skillNames.join(" · ")
                              : "Навыки не указаны"}
                          </span>
                        </div>

                      </div>

                      <div className="request-changes">
                        {changedDays.length === 0 ? (
                          <div>
                            <span>Без изменений</span>
                          </div>
                        ) : (
                          changedDays.map((day) => (
                            <div key={day.dayOfWeek}>
                              <b>{day.name}</b>
                              <span className={day.off ? "off" : ""}>
                                {day.text}
                              </span>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="request-comment">
                        {request.comment
                          ? `«${request.comment}»`
                          : "Заявка на изменение"}
                      </div>

                      {request.status === "PENDING" ? (
                        <div className="manager-actions">

                          <button
                            type="button"
                            className="reject-button"
                            onClick={() =>
                              updateRequestStatus(request, "REJECTED")
                            }
                          >
                            Отклонить
                          </button>

                          <button
                            type="button"
                            className="approve-button"
                            onClick={() =>
                              updateRequestStatus(request, "APPROVED")
                            }
                          >
                            Подтвердить
                          </button>

                        </div>
                      ) : (
                        <div className="manager-actions">
                          <span
                            className={
                              request.status === "APPROVED"
                                ? "request-status approved"
                                : "request-status rejected"
                            }
                          >
                            {requestStatusLabels[request.status] ||
                              request.status}
                          </span>
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            )}

          </div>

          <div className="manager-card">

            <div className="manager-card-header">

              <div>

                <h2>
                  Обучение сотрудников
                </h2>

                <p>
                  Кто на каких позициях обучен
                </p>

              </div>

            </div>

            <div className="training-table">

              <div className="training-row training-head">

                <span>
                  Сотрудник
                </span>

                <span>
                  Касса
                </span>

                <span>
                  Кухня
                </span>

                <span>
                  Выдача
                </span>

                <span>
                  Зал
                </span>

              </div>

              <div className="training-row">

                <span>
                 <b>
  {employees.find((employee) => employee.username === "katya")?.name || "Катя"}
</b>
                </span>

                <span className="skill-yes">
                  ✓
                </span>

                <span className="skill-no">
                  —
                </span>

                <span className="skill-yes">
                  ✓
                </span>

                <span className="skill-yes">
                  ✓
                </span>

              </div>

              <div className="training-row">

                <span>
                  <b>
  {employees.find((employee) => employee.username === "alina")?.name || "Алина"}
</b>
                </span>

                <span className="skill-yes">
                  ✓
                </span>

                <span className="skill-yes">
                  ✓
                </span>

                <span className="skill-yes">
                  ✓
                </span>

                <span className="skill-no">
                  —
                </span>

              </div>

              <div className="training-row">

                <span>
                  <b>
  {employees.find((employee) => employee.username === "denis")?.name || "Денис"}
</b>
                </span>

                <span className="skill-no">
                  —
                </span>

                <span className="skill-yes">
                  ✓
                </span>

                <span className="skill-yes">
                  ✓
                </span>

                <span className="skill-yes">
                  ✓
                </span>

              </div>

            </div>

          </div>

        </section>

        <section className="ai-card">

          <div className="ai-icon">
            🤖
          </div>

          <div className="ai-text">

            <h2>
              AI-планировщик
            </h2>

            <p>
              Автоматически построить расписание,
              учитывая доступность сотрудников,
              обучение, нагрузку и показатель
              джипик.
            </p>

          </div>

          <button
            className="ai-button"
            onClick={async () => {
              try {
                const response = await fetch("/api/schedule/generate", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({}),
                });

                const data = await response.json();

                if (!response.ok) {
                  throw new Error(
                    data.error || "Не удалось создать расписание"
                  );
                }

                const warnings = Array.isArray(data.warnings)
                  ? data.warnings
                  : [];
                const generatedShifts = Array.isArray(data.shifts)
                  ? data.shifts
                  : [];

                setShifts(generatedShifts);

                alert(
                  `Расписание создано!\n\nКоличество смен: ${generatedShifts.length}\n\n` +
                    (warnings.length > 0
                      ? "Предупреждения:\n" + warnings.join("\n")
                      : "Предупреждений нет.")
                );
              } catch (error) {
                alert(
                  error instanceof Error
                    ? error.message
                    : "Произошла ошибка при создании расписания"
                );
              }
            }}
          >
            Создать расписание
          </button>

        </section>

        <section
          style={{
            marginTop: "32px",
            background: "#ffffff",
            borderRadius: "20px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.06)",
          }}
        >
          <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 700 }}>
                Созданное расписание
              </h2>
              <p style={{ margin: "6px 0 0", color: "#777", fontSize: "14px" }}>
                Сохранённые смены сотрудников · Загружено смен: {shifts.length}
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const response = await fetch("/api/schedule", { cache: "no-store" });
                  const data = await response.json();
                  if (!response.ok || !Array.isArray(data.shifts)) {
                    throw new Error(data.error || "Сервер не вернул список смен");
                  }
                  setShifts(data.shifts);
                  alert(`Расписание обновлено. Смен: ${data.shifts.length}`);
                } catch (error) {
                  alert(error instanceof Error ? error.message : "Не удалось загрузить расписание");
                }
              }}
              style={{ background: "#176b3a", color: "white", border: "none", borderRadius: "10px", padding: "11px 16px", fontWeight: 700, cursor: "pointer" }}
            >
              Обновить расписание
            </button>
          </div>

          {shifts.length === 0 ? (
            <div
              style={{
                padding: "28px",
                textAlign: "center",
                color: "#777",
                background: "#f8f9f8",
                borderRadius: "14px",
              }}
            >
              Смен пока нет. Нажми «Создать расписание», чтобы сформировать график.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "620px" }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "#f4f8f5" }}>
                    <th style={{ padding: "12px", borderBottom: "1px solid #e5e5e5" }}>Дата</th>
                    <th style={{ padding: "12px", borderBottom: "1px solid #e5e5e5" }}>Сотрудник</th>
                    <th style={{ padding: "12px", borderBottom: "1px solid #e5e5e5" }}>Время</th>
                    <th style={{ padding: "12px", borderBottom: "1px solid #e5e5e5" }}>Перерыв</th>
                    <th style={{ padding: "12px", borderBottom: "1px solid #e5e5e5" }}>Позиция</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => {
                    const date = new Date(shift.date);
                    const dateLabel = Number.isNaN(date.getTime())
                      ? String(shift.date)
                      : date.toLocaleDateString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

                    return (
                      <tr key={shift.id}>
                        <td style={{ padding: "12px", borderBottom: "1px solid #eee" }}>{dateLabel}</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid #eee", fontWeight: 600 }}>{shift.employee?.name || `ID ${shift.employeeId}`}</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>{shift.startTime}–{shift.endTime}</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid #eee" }}>{shift.breakMins} мин.</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid #eee" }}>{shift.roleName}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ marginTop: "14px", color: "#666" }}>
                Всего смен: <strong>{shifts.length}</strong>
              </p>
            </div>
          )}
        </section>

      </main>
    );
  }

  /*
   * ============================
   * КАБИНЕТ СОТРУДНИКА
   * ============================
   */

  if (loggedIn) {
    return (
      <main className="dashboard-page">

        <header className="topbar">

          <div>

            <div className="brand">
              MAK Schedule AI
            </div>

            <div className="subtitle">
              Личный кабинет сотрудника
            </div>

          </div>

          <button
            className="logout-button"
            onClick={logout}
          >
            Выйти
          </button>

        </header>

        {!showRequest && (
          <>

            <section className="welcome">

              <div>

                <h1>
                  Привет, {currentEmployeeName || "коллега"}! 👋
                </h1>

                <p>
                  Здесь ты можешь посмотреть свой
                  график и отправить изменения
                  доступности на текущую неделю.
                </p>

              </div>

              <div className="employee-avatar">
                {(currentEmployeeName || "?").charAt(0).toUpperCase()}
              </div>

            </section>

            <section className="dashboard-grid">

              <div className="dashboard-card">

                <div className="card-icon">
                  📅
                </div>

                <h2>
                  Мой график
                </h2>

                {myShifts.length === 0 ? (
                  <p>
                    Смен пока нет. График появится
                    здесь, когда менеджер его утвердит.
                  </p>
                ) : (
                  <div className="availability">
                    {myShifts.map((shift) => {
                      const shiftDate = new Date(shift.date);
                      const dateLabel = Number.isNaN(shiftDate.getTime())
                        ? String(shift.date)
                        : shiftDate.toLocaleDateString("ru-RU", {
                            timeZone: "UTC",
                            weekday: "short",
                            day: "2-digit",
                            month: "2-digit",
                          });

                      return (
                        <div key={shift.id}>
                          <b>{dateLabel}</b>
                          <span>
                            {shift.startTime}–{shift.endTime} · {shift.roleName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>

              <div className="dashboard-card">

                <div className="card-icon">
                  🕐
                </div>

                <h2>
                  Моя доступность
                </h2>

                <p>
                  Постоянное время, в которое ты
                  можешь работать.
                </p>

                <div className="availability">

                  <div>
                    <b>Пн</b>
                    <span>
                      Выходной
                    </span>
                  </div>

                  <div>
                    <b>Вт</b>
                    <span>
                      17:00–22:00
                    </span>
                  </div>

                  <div>
                    <b>Ср</b>
                    <span>
                      17:00–22:00
                    </span>
                  </div>

                  <div>
                    <b>Чт</b>
                    <span>
                      Выходной
                    </span>
                  </div>

                  <div>
                    <b>Пт</b>
                    <span>
                      17:00–22:00
                    </span>
                  </div>

                </div>

              </div>

              <div className="dashboard-card special-card">

                <div className="card-icon">
                  ✏️
                </div>

                <h2>
                  Изменить доступность
                </h2>

                <p>
                  Нужно изменить время работы
                  или взять выходной на этой неделе?
                </p>

                <button
                  className="green-button"
                  onClick={() =>
                    setShowRequest(true)
                  }
                >
                  Создать заявку
                </button>

              </div>

              <div className="dashboard-card">

                <div className="card-icon">
                  🎓
                </div>

                <h2>
                  Мои навыки
                </h2>

                <p>
                  Роли и направления,
                  на которые ты обучена.
                </p>

                <div className="skills">

                  <span>
                    Касса
                  </span>

                  <span>
                    Выдача
                  </span>

                  <span>
                    Прилавок
                  </span>

                </div>

              </div>

            </section>

            <section className="request-section">

              <div>

                <h2>
                  Последняя заявка
                </h2>

                <p>
                  {myRequests.length > 0 || requestSent
                    ? "Изменение доступности на текущую неделю"
                    : "Заявок пока нет"}
                </p>

              </div>

              <div
                className={
                  myRequests.length > 0
                    ? myRequests[0].status === "APPROVED"
                      ? "request-status approved"
                      : myRequests[0].status === "REJECTED"
                      ? "request-status rejected"
                      : "request-status"
                    : requestSent
                    ? "request-status"
                    : "request-status empty"
                }
              >
                {myRequests.length > 0
                  ? requestStatusLabels[myRequests[0].status] ||
                    myRequests[0].status
                  : requestSent
                  ? "На рассмотрении"
                  : "Нет заявок"}
              </div>

            </section>

          </>
        )}

        {showRequest && (
          <section className="request-page">

            <div className="request-header">

              <button
                className="back-button"
                onClick={cancelRequest}
              >
                ← Назад
              </button>

              <h1>
                Изменение доступности
              </h1>

              <p>
                Неделя 5–11 октября
              </p>

            </div>

            <form
              className="request-form"
              onSubmit={submitRequest}
            >

              <div className="request-info">

                <strong>
                  Важно
                </strong>

                <span>
                  Здесь можно одновременно изменить
                  время работы и запросить выходные.
                  Постоянная доступность при этом
                  не изменяется.
                </span>

              </div>

              <h2>
                Что изменить?
              </h2>

              <div className="days-list">

                {days.map((day) => {

                  const change =
                    changes[day.id];

                  return (
                    <div
                      className="day-row"
                      key={day.id}
                    >

                      <div className="day-name">

                        <strong>
                          {day.short}
                        </strong>

                        <span>
                          {day.name}
                        </span>

                      </div>

                      <select
                        value={change.mode}
                        onChange={(e) =>
                          updateDay(
                            day.id,
                            "mode",
                            e.target.value
                          )
                        }
                      >

                        <option value="same">
                          Без изменений
                        </option>

                        <option value="time">
                          Изменить время
                        </option>

                        <option value="off">
                          Выходной
                        </option>

                      </select>

                      {change.mode ===
                        "time" && (
                        <div className="time-fields">

                          <input
                            type="time"
                            value={change.start}
                            onChange={(e) =>
                              updateDay(
                                day.id,
                                "start",
                                e.target.value
                              )
                            }
                          />

                          <span>
                            —
                          </span>

                          <input
                            type="time"
                            value={change.end}
                            onChange={(e) =>
                              updateDay(
                                day.id,
                                "end",
                                e.target.value
                              )
                            }
                          />

                        </div>
                      )}

                      {change.mode ===
                        "off" && (
                        <div className="day-off-label">
                          Выходной
                        </div>
                      )}

                    </div>
                  );
                })}

              </div>

              <div className="comment-block">

                <label>
                  Комментарий
                </label>

                <textarea
                  placeholder="Например: из-за учебы..."
                  value={comment}
                  onChange={(e) =>
                    setComment(e.target.value)
                  }
                />

              </div>

              <div className="request-actions">

                <button
                  type="button"
                  className="cancel-button"
                  onClick={cancelRequest}
                >
                  Отмена
                </button>

                <button
                  type="submit"
                  className="submit-button"
                >
                  Отправить заявку
                </button>

              </div>

            </form>

          </section>
        )}

      </main>
    );
  }

  /*
   * ============================
   * СТРАНИЦА ВХОДА
   * ============================
   */

  return (
    <main className="login-page">

      <div className="login-card">

        <div className="logo">

          <div className="logo-main">
            MAK{" "}
            <span>
              Schedule AI
            </span>
          </div>

          <p>
            Умное планирование смен
          </p>

        </div>

        <form onSubmit={handleLogin}>

          <label>
            Логин
          </label>

          <input
            type="text"
            placeholder="Введите логин"
            value={login}
            onChange={(e) =>
              setLogin(e.target.value)
            }
          />

          <label>
            Пароль
          </label>

          <input
            type="password"
            placeholder="Введите пароль"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
          />

          {error && (
            <div className="error">
              {error}
            </div>
          )}

          <button type="submit">
            Войти
          </button>

        </form>

        <div className="demo-info">

          <b>
            Демо-доступ
          </b>

          <div>
            Сотрудник:
            {" "}
            <strong>katya</strong>
            {" / "}
            <strong>mak123</strong>
          </div>

          <div>
            Менеджер:
            {" "}
            <strong>manager</strong>
            {" / "}
            <strong>makadmin</strong>
          </div>

        </div>

      </div>

    </main>
  );
}
