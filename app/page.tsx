
"use client";

import { useEffect, useState } from "react";
import WeekSchedule from "./WeekSchedule";
import ChangePassword from "./ChangePassword";
import { RegisterPanel, TrainingPanel } from "./StaffPanels";
import { splitComment } from "../src/lib/request-meta";
import { analyzeWeek, TARGET_GPIK } from "../src/lib/planner";

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
  COUNTER: "Предложен другой вариант",
  DECLINED: "Отклонена сотрудником",
};

function statusClassName(status: string) {
  if (status === "APPROVED") return "request-status approved";
  if (status === "REJECTED" || status === "DECLINED")
    return "request-status rejected";
  return "request-status";
}

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
// Целевая неделя для заявок и графика: текущая, а с субботы — следующая
function getTargetWeekStart(value: Date) {
  const monday = getWeekStart(value);
  const day = value.getDay();

  if (day === 0 || day === 6) {
    monday.setUTCDate(monday.getUTCDate() + 7);
  }

  return monday;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// «23.11–29.11» по понедельнику недели
function formatWeekRange(monday: Date) {
  const end = new Date(monday);
  end.setUTCDate(end.getUTCDate() + 6);

  const format = (date: Date) =>
    `${String(date.getUTCDate()).padStart(2, "0")}.${String(
      date.getUTCMonth() + 1
    ).padStart(2, "0")}`;

  return `${format(monday)}–${format(end)}`;
}

function mondayOfDateText(value: string) {
  const date = new Date(String(value).slice(0, 10) + "T00:00:00.000Z");
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return date;
}

type RequestDayInfo = {
  dayOfWeek: number;
  name: string;
  off: boolean;
  text: string;
};

function describeRequestDays(request: any): RequestDayInfo[] {
  if (!Array.isArray(request?.days)) return [];

  return request.days
    .filter((day: any) => day.mode !== "SAME")
    .map((day: any): RequestDayInfo => ({
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
  const [showForgot, setShowForgot] = useState(false);
  const [managerTab, setManagerTab] = useState<"new" | "history">("new");
  const [managerView, setManagerView] = useState<"main" | "staff" | "training">("main");
  const [historyLimit, setHistoryLimit] = useState(10);
  const [proposeId, setProposeId] = useState<number | null>(null);
  const [proposeChanges, setProposeChanges] = useState<
    Record<string, DayChange>
  >(createInitialChanges());
  const [proposeNote, setProposeNote] = useState("");

  function openPropose(request: any) {
    const initial = createInitialChanges();

    if (Array.isArray(request?.days)) {
      days.forEach((day, index) => {
        const item = request.days.find(
          (entry: any) => entry.dayOfWeek === index + 1
        );

        if (item?.mode === "OFF") {
          initial[day.id] = { mode: "off", start: "17:00", end: "22:00" };
        } else if (item?.mode === "TIME") {
          initial[day.id] = {
            mode: "time",
            start: item.startTime || "17:00",
            end: item.endTime || "22:00",
          };
        }
      });
    }

    setProposeChanges(initial);
    setProposeNote("");
    setProposeId(request.id);
  }

  function updateProposeDay(
    dayId: string,
    field: keyof DayChange,
    value: string
  ) {
    setProposeChanges((current) => ({
      ...current,
      [dayId]: { ...current[dayId], [field]: value },
    }));
  }

  async function submitProposal(request: any) {
    try {
      const response = await fetch("/api/requests/propose", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: request.id,
          note: proposeNote,
          days: days.map((day, index) => {
            const change = proposeChanges[day.id];

            return {
              dayOfWeek: index + 1,
              mode:
                change.mode === "off"
                  ? "OFF"
                  : change.mode === "time"
                  ? "TIME"
                  : "SAME",
              startTime: change.mode === "time" ? change.start : null,
              endTime: change.mode === "time" ? change.end : null,
            };
          }),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Не удалось отправить вариант");
        return;
      }

      setManagerRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, ...data.request, employee: item.employee }
            : item
        )
      );
      setProposeId(null);
    } catch (error) {
      console.error("SUBMIT_PROPOSAL_ERROR:", error);
      alert("Не удалось подключиться к серверу");
    }
  }

  const [shifts, setShifts] = useState<any[]>([]);
  const [myShifts, setMyShifts] = useState<any[]>([]);
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [myAvailability, setMyAvailability] = useState<any[]>([]);
  const [mySkills, setMySkills] = useState<string[]>([]);
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

  // Менеджер видит ответ сотрудника без перезагрузки страницы
  useEffect(() => {
    if (!managerLoggedIn || proposeId !== null) return;

    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/requests", { cache: "no-store" });
        const data = await response.json();

        if (response.ok && Array.isArray(data.requests)) {
          setManagerRequests(data.requests);
        }
      } catch (error) {
        console.error("REFRESH_REQUESTS_ERROR:", error);
      }
    }, 15000);

    return () => clearInterval(timer);
  }, [managerLoggedIn, proposeId]);

  async function respondToProposal(request: any, action: "accept" | "decline") {
    if (!currentEmployeeId) return;

    try {
      const response = await fetch("/api/requests/respond", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: request.id,
          employeeId: currentEmployeeId,
          action,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Не удалось отправить ответ");
        loadMyData(currentEmployeeId);
        return;
      }

      // После согласия график недели пересобирается с новым вариантом
      if (action === "accept") {
        await fetch("/api/schedule/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weekStart: String(request.weekStart).slice(0, 10),
          }),
        });
      }

      loadMyData(currentEmployeeId);
    } catch (error) {
      console.error("RESPOND_PROPOSAL_ERROR:", error);
      alert("Не удалось подключиться к серверу");
    }
  }

  async function loadMyData(employeeId: number) {
    try {
      const [shiftsResponse, requestsResponse, availabilityResponse] =
        await Promise.all([
          fetch("/api/schedule", { cache: "no-store" }),
          fetch(`/api/requests?employeeId=${employeeId}`, { cache: "no-store" }),
          fetch(`/api/availability?employeeId=${employeeId}`, {
            cache: "no-store",
          }),
        ]);

      const shiftsData = await shiftsResponse.json();
      const requestsData = await requestsResponse.json();
      const availabilityData = await availabilityResponse.json();

      if (availabilityResponse.ok) {
        if (Array.isArray(availabilityData.availabilities)) {
          setMyAvailability(availabilityData.availabilities);
        }
        if (Array.isArray(availabilityData.skills)) {
          setMySkills(availabilityData.skills);
        }
      }

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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadMyData(currentEmployeeId);
    }, 15000);

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
        weekStart: toDateKey(getTargetWeekStart(new Date())),
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
    setError("");
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
    // «Новые»: ждут решения менеджера или ответа сотрудника
    const activeRequests = [
      ...pendingRequests,
      ...managerRequests.filter((request) => request.status === "COUNTER"),
    ];
    // «История»: всё, что уже решено, самые свежие сверху
    const historyRequests = managerRequests
      .filter(
        (request) =>
          request.status !== "PENDING" && request.status !== "COUNTER"
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.createdAt).getTime() -
          new Date(a.updatedAt ?? a.createdAt).getTime()
      );
    // Анализ недели, на которую созданы последние смены
    let analysis: ReturnType<typeof analyzeWeek> | null = null;
    if (shifts.length > 0) {
      const latestDate = shifts.reduce(
        (max: string, shift: any) =>
          String(shift.date) > max ? String(shift.date) : max,
        ""
      );
      analysis = analyzeWeek(shifts, mondayOfDateText(latestDate));
    }
    const gpikColor = (value: number | null) =>
      value === null
        ? "#718078"
        : value <= TARGET_GPIK * 1.1
        ? "#087f3e"
        : value <= TARGET_GPIK * 1.4
        ? "#b7791f"
        : "#b42318";
    const visibleRequests =
      managerTab === "new"
        ? activeRequests
        : historyRequests.slice(0, historyLimit);
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

          <ChangePassword username={login} currentPassword={password} onChanged={setPassword} />
          <button
            className="logout-button"
            onClick={logout}
          >
            Выйти
          </button>

        </header>

        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0 0" }}>
          {([["main", "Заявки и расписание"], ["staff", "Сотрудники"], ["training", "Обучение"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setManagerView(id)}
              style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid", cursor: "pointer", fontWeight: 700,
                borderColor: managerView === id ? "#087f3e" : "#d5e2da",
                background: managerView === id ? "#087f3e" : "white",
                color: managerView === id ? "white" : "#30493a" }}>
              {label}
            </button>
          ))}
        </nav>

        {managerView === "staff" && <RegisterPanel managerLogin={login} managerPassword={password} />}
        {managerView === "training" && <TrainingPanel />}
        {managerView === "main" && (<>

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
              <strong>
                {analysis && analysis.avgGpik !== null
                  ? analysis.avgGpik.toFixed(1)
                  : "—"}
              </strong>

              <p>
                Средний джипик (цель {TARGET_GPIK})
              </p>
            </div>

          </div>

        </section>

        <section className="manager-content">

          <div className="manager-card">

            <div className="manager-card-header">

              <div>

                <h2>
                  Заявки сотрудников
                </h2>

                <p>
                  Изменения доступности сотрудников
                </p>

              </div>

              <span className="counter">
                {activeRequests.length}
              </span>

            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              {(
                [
                  { id: "new", label: "Новые", count: activeRequests.length },
                  { id: "history", label: "История", count: historyRequests.length },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setManagerTab(tab.id)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "10px",
                    border: "1px solid",
                    borderColor: managerTab === tab.id ? "#087f3e" : "#d5e2da",
                    background: managerTab === tab.id ? "#087f3e" : "white",
                    color: managerTab === tab.id ? "white" : "#30493a",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  {tab.label} · {tab.count}
                </button>
              ))}
            </div>

            {visibleRequests.length === 0 ? (
              <div
                style={{
                  padding: "28px",
                  textAlign: "center",
                  color: "#718078",
                  background: "#fbfdfc",
                  border: "1px dashed #d5e2da",
                  borderRadius: "12px",
                }}
              >
                {managerTab === "new"
                  ? "Новых заявок нет"
                  : "Решённых заявок пока нет"}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {visibleRequests.map((request) => {
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
                  const commentParts = splitComment(request.comment);
                  const isEditing = proposeId === request.id;

                  return (
                    <div key={request.id}>

                      <div className="request-manager">

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
                          {request.status === "COUNTER" && (
                            <div>
                              <span style={{ fontWeight: 700 }}>
                                Твой вариант:
                              </span>
                            </div>
                          )}
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
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#718078",
                              marginBottom: "4px",
                            }}
                          >
                            Неделя{" "}
                            {formatWeekRange(
                              mondayOfDateText(request.weekStart)
                            )}
                          </div>
                          {commentParts.text
                            ? `«${commentParts.text}»`
                            : "Заявка на изменение"}
                          {commentParts.managerNote && (
                            <div style={{ marginTop: "6px" }}>
                              Ответ менеджера: «{commentParts.managerNote}»
                            </div>
                          )}
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
                              className="edit-button"
                              onClick={() => openPropose(request)}
                            >
                              Предложить вариант
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
                            <span className={statusClassName(request.status)}>
                              {request.status === "COUNTER"
                                ? "Ждём ответа сотрудника"
                                : requestStatusLabels[request.status] ||
                                  request.status}
                            </span>
                          </div>
                        )}

                      </div>

                      {isEditing && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "18px",
                            border: "1px solid #b7dcc6",
                            borderRadius: "12px",
                            background: "#f4fbf7",
                          }}
                        >
                          <strong style={{ display: "block", marginBottom: "4px" }}>
                            Твой вариант для {employeeName}
                          </strong>
                          <p
                            style={{
                              margin: "0 0 14px",
                              fontSize: "12px",
                              color: "#718078",
                            }}
                          >
                            Исправь время или выходные. «Без изменений» значит
                            постоянная доступность сотрудника. После отправки
                            сотрудник сможет согласиться или отклонить.
                          </p>

                          <div className="days-list">
                            {days.map((day) => {
                              const change = proposeChanges[day.id];

                              return (
                                <div className="day-row" key={day.id}>

                                  <div className="day-name">
                                    <strong>{day.short}</strong>
                                    <span>{day.name}</span>
                                  </div>

                                  <select
                                    value={change.mode}
                                    onChange={(e) =>
                                      updateProposeDay(
                                        day.id,
                                        "mode",
                                        e.target.value
                                      )
                                    }
                                  >
                                    <option value="same">Без изменений</option>
                                    <option value="time">Изменить время</option>
                                    <option value="off">Выходной</option>
                                  </select>

                                  {change.mode === "time" && (
                                    <div className="time-fields">
                                      <input
                                        type="time"
                                        value={change.start}
                                        onChange={(e) =>
                                          updateProposeDay(
                                            day.id,
                                            "start",
                                            e.target.value
                                          )
                                        }
                                      />
                                      <span>—</span>
                                      <input
                                        type="time"
                                        value={change.end}
                                        onChange={(e) =>
                                          updateProposeDay(
                                            day.id,
                                            "end",
                                            e.target.value
                                          )
                                        }
                                      />
                                    </div>
                                  )}

                                  {change.mode === "off" && (
                                    <div className="day-off-label">Выходной</div>
                                  )}

                                </div>
                              );
                            })}
                          </div>

                          <div className="comment-block">
                            <label>Комментарий для сотрудника</label>
                            <textarea
                              placeholder="Например: в пятницу нужен человек до закрытия"
                              value={proposeNote}
                              onChange={(e) => setProposeNote(e.target.value)}
                            />
                          </div>

                          <div className="request-actions">
                            <button
                              type="button"
                              className="cancel-button"
                              onClick={() => setProposeId(null)}
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              className="submit-button"
                              onClick={() => submitProposal(request)}
                            >
                              Отправить вариант
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  );
                })}

                {managerTab === "history" &&
                  historyRequests.length > historyLimit && (
                    <button
                      type="button"
                      onClick={() => setHistoryLimit((value) => value + 10)}
                      style={{
                        padding: "10px",
                        borderRadius: "10px",
                        border: "1px solid #d5e2da",
                        background: "white",
                        color: "#30493a",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Показать ещё
                    </button>
                  )}
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
              Автоматически построить расписание:
              доступность и заявки сотрудников,
              обучение по позициям, ожидаемые
              заказы и целевой джипик {TARGET_GPIK}.
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

        {analysis && (
          <section
            style={{
              marginTop: "32px",
              background: "#ffffff",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.06)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 700 }}>
              Анализ недели
            </h2>
            <p style={{ margin: "6px 0 18px", color: "#777", fontSize: "14px" }}>
              Джипик — заказы на одного работника в час. Цель: {TARGET_GPIK}.
              Прогноз заказов пока примерный.
            </p>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "#f4f8f5" }}>
                    <th style={{ padding: "10px", borderBottom: "1px solid #e5e5e5" }}>День</th>
                    <th style={{ padding: "10px", borderBottom: "1px solid #e5e5e5" }}>Заказов</th>
                    <th style={{ padding: "10px", borderBottom: "1px solid #e5e5e5" }}>Смен</th>
                    <th style={{ padding: "10px", borderBottom: "1px solid #e5e5e5" }}>Джипик</th>
                    <th style={{ padding: "10px", borderBottom: "1px solid #e5e5e5" }}>Пик</th>
                    <th style={{ padding: "10px", borderBottom: "1px solid #e5e5e5" }}>Что не так</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.days.map((day) => (
                    <tr key={day.date}>
                      <td style={{ padding: "10px", borderBottom: "1px solid #eee", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {days[day.dayIndex].short} {day.date.slice(8, 10)}.{day.date.slice(5, 7)}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>{day.orders}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>{day.shifts}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #eee", fontWeight: 700, color: gpikColor(day.avgGpik) }}>
                        {day.avgGpik === null ? "—" : day.avgGpik.toFixed(1)}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #eee", color: gpikColor(day.peakGpik) }}>
                        {day.peakGpik === null ? "—" : day.peakGpik.toFixed(1)}
                      </td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #eee", fontSize: "13px", color: "#53655b" }}>
                        {day.issues.length === 0
                          ? "Всё в порядке"
                          : day.issues.map((issue) => (
                              <div key={issue}>{issue}</div>
                            ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <WeekSchedule
          shifts={shifts}
          onRefresh={async () => {
            try {
              const response = await fetch("/api/schedule", { cache: "no-store" });
              const data = await response.json();
              if (!response.ok || !Array.isArray(data.shifts)) {
                throw new Error(data.error || "Сервер не вернул список смен");
              }
              setShifts(data.shifts);
            } catch (error) {
              alert(error instanceof Error ? error.message : "Не удалось загрузить расписание");
            }
          }}
        />
        </>)}

      </main>
    );
  }

  /*
   * ============================
   * КАБИНЕТ СОТРУДНИКА
   * ============================
   */

  if (loggedIn) {
    const targetWeek = getTargetWeekStart(new Date());
    const targetWeekKey = toDateKey(targetWeek);
    const nextWeek = new Date(targetWeek);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const nextWeekKey = toDateKey(nextWeek);

    // Последняя подтверждённая заявка на целевую неделю
    const approvedForWeek = myRequests.find((item) => {
      const key = String(item.weekStart).slice(0, 10);
      return (
        item.status === "APPROVED" &&
        key >= targetWeekKey &&
        key < nextWeekKey
      );
    });

    const availabilityRows = days.map((day, index) => {
      const dayOfWeek = index + 1;
      const base = myAvailability.find(
        (item) => item.dayOfWeek === dayOfWeek
      );
      let text = "Выходной";

      if (base && !base.isOff && base.startTime && base.endTime) {
        text = `${base.startTime}–${base.endTime}`;
      }

      return { id: day.id, short: day.short, text };
    });

    // Заявки, на которые менеджер предложил другой вариант
    const counterRequests = myRequests.filter(
      (item) => item.status === "COUNTER"
    );
    const approvedChanges = describeRequestDays(approvedForWeek);

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

          <ChangePassword username={login} currentPassword={password} onChanged={setPassword} />
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
                  Постоянное время, в которое ты можешь работать.
                </p>

                <div className="availability">

                  {availabilityRows.map((row) => (
                    <div key={row.id}>
                      <b>{row.short}</b>
                      <span>{row.text}</span>
                    </div>
                  ))}

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

                  {mySkills.length === 0 ? (
                    <span>Навыки пока не указаны</span>
                  ) : (
                    mySkills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))
                  )}

                </div>

              </div>

            </section>

            {counterRequests.map((item) => {
              const parts = splitComment(item.comment);

              return (
                <section
                  className="request-section"
                  key={item.id}
                  style={{
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: "14px",
                    background: "#fffdf5",
                    borderColor: "#f0d78a",
                  }}
                >
                  <div>
                    <h2>Менеджер предложил другой вариант</h2>
                    <p>
                      Неделя{" "}
                      {formatWeekRange(mondayOfDateText(item.weekStart))}.
                      Согласись или отклони предложение.
                    </p>
                  </div>

                  {parts.managerNote && (
                    <div className="request-comment">
                      «{parts.managerNote}»
                    </div>
                  )}

                  <div className="request-changes">
                    {describeRequestDays(item).length === 0 ? (
                      <div>
                        <span>Без изменений постоянной доступности</span>
                      </div>
                    ) : (
                      describeRequestDays(item).map((day) => (
                        <div key={day.dayOfWeek}>
                          <b>{day.name}</b>
                          <span className={day.off ? "off" : ""}>
                            {day.text}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="manager-actions">
                    <button
                      type="button"
                      className="reject-button"
                      onClick={() => respondToProposal(item, "decline")}
                    >
                      Отклонить
                    </button>
                    <button
                      type="button"
                      className="approve-button"
                      onClick={() => respondToProposal(item, "accept")}
                    >
                      Согласиться
                    </button>
                  </div>
                </section>
              );
            })}

            {approvedChanges.length > 0 && (
              <section
                className="request-section"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: "12px",
                }}
              >
                <div>
                  <h2>Изменения на неделю {formatWeekRange(targetWeek)}</h2>
                  <p>Из подтверждённой заявки. Постоянная доступность не менялась.</p>
                </div>

                <div className="request-changes">
                  {approvedChanges.map((day) => (
                    <div key={day.dayOfWeek}>
                      <b>{day.name} ✎</b>
                      <span className={day.off ? "off" : ""}>{day.text}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

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
                    ? statusClassName(myRequests[0].status)
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
                Неделя {formatWeekRange(getTargetWeekStart(new Date()))}
              </p>

            </div>

            <form
              className="request-form"
              onSubmit={submitRequest}
            >

              {error && (
                <div className="error" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              )}

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

          <button type="button" onClick={() => setShowForgot(!showForgot)}
            style={{ background: "none", border: "none", color: "#087f3e", fontWeight: 700, cursor: "pointer", marginTop: 12 }}>
            Забыли пароль?
          </button>
          {showForgot && (
            <div style={{ marginTop: 8, padding: 12, borderRadius: 10, background: "#f4f8f5", fontSize: 14, color: "#30493a" }}>
              Обратитесь к менеджеру: он задаст вам новый пароль в разделе «Сотрудники». После входа его можно поменять на свой кнопкой «Сменить пароль».
            </div>
          )}
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
