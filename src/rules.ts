// 排产规则：时段冲突判定、急件顶单、改期/换人先释放再校验。
// 全部为纯函数，不碰存储与界面，方便单独核对规则。

export type TaskStatus = "pending" | "scheduled" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string; // 工单名
  urgent: boolean; // 是否急件
  status: TaskStatus;
  masterId: string | null; // 师傅
  stationId: string | null; // 工位
  start: string | null; // 时段起点 "HH:MM"
  durationMin: number; // 预计时长（分钟）
  bumpReason: string | null; // 被顶回待安排时记录的原因
}

export interface LogEntry {
  id: string;
  at: string; // ISO 时间
  kind: "conflict" | "bump"; // 冲突被拒 / 急件顶单
  text: string;
}

export interface BoardState {
  tasks: Task[];
  logs: LogEntry[];
}

export interface SlotInput {
  masterId: string;
  stationId: string;
  start: string;
  durationMin: number;
}

// ---------- 基础数据：师傅与工位 ----------

export const MASTERS = [
  { id: "m1", name: "张翠山", skill: "爪镶" },
  { id: "m2", name: "李青萝", skill: "微镶" },
  { id: "m3", name: "王守拙", skill: "包镶" },
  { id: "m4", name: "赵灵犀", skill: "群镶/补石" },
] as const;

export const STATIONS = [
  { id: "s1", name: "1号镶石台" },
  { id: "s2", name: "2号微镶台" },
  { id: "s3", name: "3号综合台" },
] as const;

export const DAY_OPEN = "09:00";
export const DAY_CLOSE = "18:00";
export const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180, 240];

export function masterName(id: string | null): string {
  return MASTERS.find((m) => m.id === id)?.name ?? "未指派";
}

export function stationName(id: string | null): string {
  return STATIONS.find((s) => s.id === id)?.name ?? "未指派";
}

// ---------- 时间工具 ----------

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function endOf(start: string, durationMin: number): string {
  return toHHMM(toMin(start) + durationMin);
}

export function overlaps(aStart: string, aDur: number, bStart: string, bDur: number): boolean {
  const a0 = toMin(aStart);
  const b0 = toMin(bStart);
  return a0 < b0 + bDur && b0 < a0 + aDur;
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min}分钟`;
  return min % 60 === 0 ? `${min / 60}小时` : `${Math.floor(min / 60)}.5小时`;
}

// ---------- 冲突检测 ----------

export interface Conflict {
  task: Task;
  viaMaster: boolean;
  viaStation: boolean;
}

// 已排班与进行中的任务才占用师傅/工位
const OCCUPYING: TaskStatus[] = ["scheduled", "in_progress"];

export function findConflicts(tasks: Task[], input: SlotInput, ignoreId?: string): Conflict[] {
  const out: Conflict[] = [];
  for (const t of tasks) {
    if (t.id === ignoreId || !t.start) continue;
    if (!OCCUPYING.includes(t.status)) continue;
    if (!overlaps(input.start, input.durationMin, t.start, t.durationMin)) continue;
    const viaMaster = t.masterId === input.masterId;
    const viaStation = t.stationId === input.stationId;
    if (viaMaster || viaStation) out.push({ task: t, viaMaster, viaStation });
  }
  return out;
}

export function describeConflict(c: Conflict): string {
  const held = [
    c.viaMaster ? `师傅「${masterName(c.task.masterId)}」` : null,
    c.viaStation ? `工位「${stationName(c.task.stationId)}」` : null,
  ]
    .filter(Boolean)
    .join("和");
  return `「${c.task.title}」（${c.task.start}–${endOf(c.task.start!, c.task.durationMin)}，已占用${held}）`;
}

// ---------- 排班校验 ----------

// 急件只可顶掉「未开工的普通任务」
export function canBump(t: Task): boolean {
  return !t.urgent && t.status === "scheduled";
}

export type Verdict = { ok: true; bumped: Task[] } | { ok: false; message: string };

export function evaluate(tasks: Task[], task: Task, input: SlotInput): Verdict {
  if (input.durationMin <= 0) {
    return { ok: false, message: "预计时长必须大于 0" };
  }
  const startMin = toMin(input.start);
  if (startMin < toMin(DAY_OPEN) || startMin + input.durationMin > toMin(DAY_CLOSE)) {
    return { ok: false, message: `时段超出营业时间 ${DAY_OPEN}–${DAY_CLOSE}` };
  }

  const conflicts = findConflicts(tasks, input, task.id);
  if (conflicts.length === 0) return { ok: true, bumped: [] };

  const desc = conflicts.map(describeConflict).join("；");
  if (!task.urgent) {
    return { ok: false, message: `与${desc}时段相撞` };
  }
  const blockers = conflicts.filter((c) => !canBump(c.task));
  if (blockers.length > 0) {
    const why = blockers
      .map((b) => `「${b.task.title}」${b.task.urgent ? "同为急件" : "已开工"}`)
      .join("、");
    return { ok: false, message: `急件只能顶掉未开工的普通任务，${why}不可顶：与${desc}相撞` };
  }
  return { ok: true, bumped: conflicts.map((c) => c.task) };
}

// ---------- 落子：先释放旧占用，再校验 ----------

export interface ApplyResult {
  state: BoardState;
  ok: boolean;
  message: string;
}

let logSeq = 0;
function makeLog(kind: LogEntry["kind"], text: string, now: Date): LogEntry {
  logSeq += 1;
  return { id: `L${now.getTime()}-${logSeq}`, at: now.toISOString(), kind, text };
}

export function applySchedule(
  state: BoardState,
  taskId: string,
  input: SlotInput,
  now: Date = new Date()
): ApplyResult {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return { state, ok: false, message: "工单不存在" };
  if (task.status === "in_progress" || task.status === "done") {
    return { state, ok: false, message: "已开工或已完工的任务不能改期，请先完工" };
  }

  // 第一步：释放旧占用（改期/换人都先回到未占用状态）
  const released = state.tasks.map((t) =>
    t.id === taskId ? { ...t, status: "pending" as TaskStatus, masterId: null, stationId: null, start: null } : t
  );

  // 第二步：对释放后的盘面校验新时段
  const verdict = evaluate(released, task, input);
  const wasScheduled = task.status === "scheduled";
  if (!verdict.ok) {
    // 校验失败：tasks 保持原样，等于恢复原排班
    const consequence = wasScheduled ? "已保留原排班" : "未排入，仍在待安排";
    const message = `${verdict.message}，${consequence}`;
    const log = makeLog(
      "conflict",
      `「${task.title}」拟排 ${input.start} 起 ${durationLabel(input.durationMin)}（${masterName(input.masterId)} / ${stationName(input.stationId)}）：${message}`,
      now
    );
    return { state: { ...state, logs: [log, ...state.logs] }, ok: false, message };
  }

  // 第三步：落位，并把被顶掉的未开工普通任务退回待安排、记录原因
  const bumpedIds = new Set(verdict.bumped.map((t) => t.id));
  const tasks = released.map((t) => {
    if (t.id === taskId) {
      return {
        ...t,
        status: "scheduled" as TaskStatus,
        masterId: input.masterId,
        stationId: input.stationId,
        start: input.start,
        durationMin: input.durationMin,
        bumpReason: null,
      };
    }
    if (bumpedIds.has(t.id)) {
      return {
        ...t,
        status: "pending" as TaskStatus,
        masterId: null,
        stationId: null,
        start: null,
        bumpReason: `被急件「${task.title}」顶掉（原 ${t.start}–${endOf(t.start!, t.durationMin)}）`,
      };
    }
    return t;
  });

  const logs = [...state.logs];
  for (const b of verdict.bumped) {
    logs.unshift(
      makeLog(
        "bump",
        `急件「${task.title}」顶掉「${b.title}」（原 ${b.start}–${endOf(b.start!, b.durationMin)} · ${masterName(b.masterId)} / ${stationName(b.stationId)}），已退回待安排`,
        now
      )
    );
  }

  const slot = `${input.start}–${endOf(input.start, input.durationMin)} · ${masterName(input.masterId)} · ${stationName(input.stationId)}`;
  const suffix = verdict.bumped.length > 0 ? `，顶掉 ${verdict.bumped.length} 单` : "";
  return {
    state: { tasks, logs },
    ok: true,
    message: `${wasScheduled ? "改期" : "排班"}成功：「${task.title}」${slot}${suffix}`,
  };
}

// ---------- 状态流转 ----------

export function startTask(state: BoardState, id: string): ApplyResult {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status !== "scheduled") {
    return { state, ok: false, message: "只有已排班且未开工的任务才能开工" };
  }
  const tasks = state.tasks.map((t) => (t.id === id ? { ...t, status: "in_progress" as TaskStatus } : t));
  return { state: { ...state, tasks }, ok: true, message: `「${task.title}」已开工` };
}

export function finishTask(state: BoardState, id: string): ApplyResult {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status !== "in_progress") {
    return { state, ok: false, message: "只有进行中的任务才能完工" };
  }
  const tasks = state.tasks.map((t) => (t.id === id ? { ...t, status: "done" as TaskStatus } : t));
  return { state: { ...state, tasks }, ok: true, message: `「${task.title}」已完工，工位与师傅已释放` };
}

// 手动退回待安排（仅未开工）
export function releaseTask(state: BoardState, id: string): ApplyResult {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status !== "scheduled") {
    return { state, ok: false, message: "只有未开工的排班才能退回" };
  }
  const tasks = state.tasks.map((t) =>
    t.id === id ? { ...t, status: "pending" as TaskStatus, masterId: null, stationId: null, start: null } : t
  );
  return { state: { ...state, tasks }, ok: true, message: `「${task.title}」已退回待安排` };
}

// ---------- 工单与记录维护 ----------

export function addTask(state: BoardState, title: string, urgent: boolean, durationMin: number): ApplyResult {
  const trimmed = title.trim();
  if (!trimmed) return { state, ok: false, message: "请填写工单名称" };
  const maxNo = state.tasks.reduce((acc, t) => {
    const n = Number(t.id.replace(/^RX-/, ""));
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 1000);
  const task: Task = {
    id: `RX-${maxNo + 1}`,
    title: trimmed,
    urgent,
    status: "pending",
    masterId: null,
    stationId: null,
    start: null,
    durationMin,
    bumpReason: null,
  };
  return {
    state: { ...state, tasks: [...state.tasks, task] },
    ok: true,
    message: `工单「${trimmed}」已加入待安排`,
  };
}

export function clearLogs(state: BoardState): BoardState {
  return { ...state, logs: [] };
}
