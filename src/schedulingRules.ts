// 排产业务规则（纯逻辑层）：师傅/工位资料、时段换算、撞单与急件顶单判定。
// 不读存储、不碰 DOM，界面与存档都只通过这里导出的规则做判断。

export type Priority = "normal" | "rush";
export type TaskStatus = "pending" | "scheduled" | "started" | "done";

export interface Master {
  id: string;
  name: string;
  title: string;
}

export interface Station {
  id: string;
  name: string;
}

/** 一件镶嵌活儿（工单）。未安排时排期字段为空。 */
export interface Task {
  id: string;
  orderNo: string;
  itemName: string;
  priority: Priority;
  status: TaskStatus;
  masterId?: string;
  stationId?: string;
  date?: string; // YYYY-MM-DD
  startSlot?: number; // 当天第几个 30 分钟时段，0 = 08:00
  duration?: number; // 占用的时段数
  /** 被急件顶回待安排等情况下的登记原因 */
  bumpReason?: string;
}

/** 表单提交的一次排期（改期/换人时带 id）。 */
export interface ScheduleDraft {
  id?: string;
  orderNo: string;
  itemName: string;
  masterId: string;
  stationId: string;
  date: string;
  startSlot: number;
  duration: number;
  priority: Priority;
}

// —— 工坊基础资料 ——

export const SLOT_MINUTES = 30;
export const DAY_START_HOUR = 8;
export const DAY_SLOTS = 24; // 08:00–20:00，共 24 个半小时时段
export const DAY_END_LABEL = "20:00";

export const MASTERS: Master[] = [
  { id: "m1", name: "赵守成", title: "主镶师傅" },
  { id: "m2", name: "孙巧云", title: "微镶师傅" },
  { id: "m3", name: "周阿福", title: "执模镶石" },
  { id: "m4", name: "吴锦添", title: "蜡镶 / 辅助" },
];

export const STATIONS: Station[] = [
  { id: "s1", name: "镶石一号台" },
  { id: "s2", name: "微镶显微镜位" },
  { id: "s3", name: "执模台" },
  { id: "s4", name: "蜡镶工位" },
];

export function masterName(id?: string): string {
  return MASTERS.find((m) => m.id === id)?.name ?? "未分配师傅";
}

export function stationName(id?: string): string {
  return STATIONS.find((s) => s.id === id)?.name ?? "未分配工位";
}

// —— 时段工具 ——

export function slotToTime(slot: number): string {
  const total = DAY_START_HOUR * 60 + slot * SLOT_MINUTES;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function rangeLabel(startSlot: number, duration: number): string {
  return `${slotToTime(startSlot)}–${slotToTime(startSlot + duration)}`;
}

export function durationLabel(duration: number): string {
  const mins = duration * SLOT_MINUTES;
  if (mins < 60) return `${mins} 分钟`;
  const h = mins / 60;
  return Number.isInteger(h) ? `${h} 小时` : `${h.toFixed(1)} 小时`;
}

export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return localDateStr(new Date());
}

export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return localDateStr(dt);
}

// —— 占用与撞单规则 ——

/** 已排、已开工都算占用工位/师傅；已完工释放资源；待安排不占。 */
export function isOccupying(task: Task): boolean {
  return task.status === "scheduled" || task.status === "started";
}

function rangesOverlap(
  dateA: string,
  startA: number,
  durA: number,
  task: Task,
): boolean {
  if (task.date !== dateA) return false;
  const startB = task.startSlot ?? 0;
  const durB = task.duration ?? 0;
  // 半小时格半开区间：前一单 09:00 结束、后一单 09:00 开始不算撞。
  return startA < startB + durB && startB < startA + durA;
}

export interface Clash {
  kind: "master" | "station";
  task: Task;
  /** 急件能否顶掉该占用：只有“未开工的普通任务”可顶 */
  bumpable: boolean;
}

export interface Evaluation {
  ok: boolean;
  errors: string[];
  clashes: Clash[];
  /** 真正拦住本次排期的冲突（普通单遇到全部冲突都拦；急件只被不可顶的拦） */
  blockers: Clash[];
  /** 急件排进后将被顶回待安排的单 */
  bumpableTasks: Task[];
}

function isBumpable(task: Task): boolean {
  return task.status === "scheduled" && task.priority === "normal";
}

/**
 * 校验一次排期。调用方需先把“被改期的旧单”从 tasks 中剔除（即先释放旧占用），
 * 这样改期/换人才不会和自己的旧时段打架。
 */
export function evaluateDraft(draft: ScheduleDraft, tasks: Task[]): Evaluation {
  const errors: string[] = [];
  if (!draft.orderNo.trim()) errors.push("请填写工单号");
  if (!draft.itemName.trim()) errors.push("请填写活儿名称");
  if (!draft.masterId) errors.push("请选择师傅");
  if (!draft.stationId) errors.push("请选择工位");
  if (!draft.date) errors.push("请选择日期");
  if (!Number.isInteger(draft.startSlot) || draft.startSlot < 0) {
    errors.push("请选择开始时段");
  }
  if (!Number.isInteger(draft.duration) || draft.duration < 1) {
    errors.push("预计时长至少 30 分钟");
  }
  if (
    Number.isInteger(draft.startSlot) &&
    Number.isInteger(draft.duration) &&
    draft.startSlot + draft.duration > DAY_SLOTS
  ) {
    errors.push(`排期会超过当日收工时间 ${DAY_END_LABEL}`);
  }

  const clashes: Clash[] = [];
  if (errors.length === 0) {
    for (const task of tasks) {
      if (task.id === draft.id) continue; // 旧占用已释放
      if (!isOccupying(task)) continue;
      if (!rangesOverlap(draft.date, draft.startSlot, draft.duration, task)) {
        continue;
      }
      if (task.masterId && task.masterId === draft.masterId) {
        clashes.push({ kind: "master", task, bumpable: isBumpable(task) });
      }
      if (task.stationId && task.stationId === draft.stationId) {
        clashes.push({ kind: "station", task, bumpable: isBumpable(task) });
      }
    }
  }

  const blockers =
    draft.priority === "normal"
      ? clashes.slice()
      : clashes.filter((c) => !c.bumpable);

  const bumpableMap = new Map<string, Task>();
  if (draft.priority === "rush") {
    for (const c of clashes) {
      if (c.bumpable && !bumpableMap.has(c.task.id)) {
        bumpableMap.set(c.task.id, c.task);
      }
    }
  }

  return {
    ok: errors.length === 0 && blockers.length === 0,
    errors,
    clashes,
    blockers,
    bumpableTasks: [...bumpableMap.values()],
  };
}

/** 资源侧的人话描述，用于冲突清单与界面提示。 */
export function clashText(clash: Clash): string {
  const t = clash.task;
  const where =
    clash.kind === "master"
      ? `师傅「${masterName(t.masterId)}」`
      : `工位「${stationName(t.stationId)}」`;
  const stateTag =
    t.status === "started"
      ? "（已开工，不可顶）"
      : t.priority === "rush"
        ? "（同为急件，不可顶）"
        : t.status === "done"
          ? "（已完工）"
          : "";
  return `${where} ${t.date} ${rangeLabel(t.startSlot ?? 0, t.duration ?? 0)} 已排 #${t.orderNo}《${t.itemName}》${stateTag}`;
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  normal: "普通",
  rush: "急件",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待安排",
  scheduled: "已排班",
  started: "开工中",
  done: "已完工",
};
