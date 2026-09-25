// 本地存档层：待安排、今日排班、冲突清单共用同一份 localStorage 数据。
// 所有改排期的动作都在这里“先释放旧占用 → 再走规则校验 → 落库”，
// 重开页面 / 刷新都能从 STORAGE_KEY 恢复继续调整。

import {
  evaluateDraft,
  masterName,
  rangeLabel,
  stationName,
  todayStr,
  type Clash,
  type Priority,
  type ScheduleDraft,
  type Task,
} from "./schedulingRules";

const STORAGE_KEY = "inlay-workshop-scheduler:v1";

export interface ClashRecord {
  id: string;
  at: string;
  orderNo: string;
  itemName: string;
  priority: Priority;
  attemptDate: string;
  /** reschedule = 改期/换人时被拦（保留了原排班）；new = 新单/待安排排期被拦 */
  kind: "new" | "reschedule";
  /** 被拦的师傅/工位冲突描述 */
  blockers: string[];
  /** 被拦时保留下来的原排班描述（改期场景） */
  keptSchedule?: string;
  resolved: boolean;
}

export interface SchedulerState {
  tasks: Task[];
  clashes: ClashRecord[];
  seq: number;
}

export type ScheduleOutcome =
  | { ok: true; taskId: string; bumped: Task[] }
  | {
      ok: false;
      errors: string[];
      clashes: Clash[];
      recordId?: string;
      keptSchedule?: string;
    };

// —— 种子数据：默认按“今天”铺好，直接就能看到撞单与急件顶单 ——

function seedTasks(): Task[] {
  const today = todayStr();
  return [
    {
      id: "seed-1",
      orderNo: "JD-1024",
      itemName: "钻戒主石镶口修整",
      priority: "normal",
      status: "scheduled",
      masterId: "m1",
      stationId: "s1",
      date: today,
      startSlot: 2, // 09:00–10:30
      duration: 3,
    },
    {
      id: "seed-2",
      orderNo: "JD-1025",
      itemName: "蓝宝石吊坠群镶",
      priority: "normal",
      status: "started",
      masterId: "m2",
      stationId: "s2",
      date: today,
      startSlot: 0, // 08:00–09:30
      duration: 3,
    },
    {
      id: "seed-3",
      orderNo: "JD-1031",
      itemName: "对戒微镶补石",
      priority: "normal",
      status: "scheduled",
      masterId: "m3",
      stationId: "s3",
      date: today,
      startSlot: 4, // 10:00–11:00
      duration: 2,
    },
    {
      id: "seed-4",
      orderNo: "JD-1036",
      itemName: "客户催单：祖母绿戒面重镶",
      priority: "rush",
      status: "scheduled",
      masterId: "m2",
      stationId: "s2",
      date: today,
      startSlot: 6, // 11:00–12:00
      duration: 2,
    },
    {
      id: "seed-5",
      orderNo: "JD-1038",
      itemName: "翡翠胸针蜡镶排石",
      priority: "normal",
      status: "pending",
    },
    {
      id: "seed-6",
      orderNo: "JD-1040",
      itemName: "项链围石补配",
      priority: "normal",
      status: "pending",
    },
  ];
}

// —— 极简发布订阅，界面订阅状态；持久化只用 localStorage，无后端、无第三方依赖 ——

type Listener = (state: SchedulerState) => void;

class SchedulerStore {
  private state: SchedulerState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = this.load();
  }

  private load(): SchedulerState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SchedulerState;
        if (Array.isArray(parsed.tasks) && Array.isArray(parsed.clashes)) {
          return {
            tasks: parsed.tasks,
            clashes: parsed.clashes,
            seq: parsed.seq ?? 0,
          };
        }
      }
    } catch {
      // 存档损坏时退回种子数据，不影响使用
    }
    return { tasks: seedTasks(), clashes: [], seq: 0 };
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 隐私模式 / 配额不足时仅本次会话可用，不阻塞操作
    }
  }

  private commit(next: SchedulerState) {
    this.state = next;
    this.persist();
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): SchedulerState {
    return this.state;
  }

  /**
   * 排期入口（新排 / 改期 / 换人 / 顶单统一走这里）。
   * 规则要求：改期或换人先释放旧占用再校验。做法是从校验集合中剔除原单，
   * 落库成功才覆盖它的时段——校验被拦时原字段原封不动，原排班保留。
   */
  schedule(draft: ScheduleDraft): ScheduleOutcome {
    const existing = draft.id
      ? this.state.tasks.find((t) => t.id === draft.id)
      : undefined;

    // 先释放旧占用：校验时不考虑本单当前的师傅/工位/时段
    const tasksForCheck = this.state.tasks.filter((t) => t.id !== draft.id);
    const evaluation = evaluateDraft(draft, tasksForCheck);

    if (!evaluation.ok) {
      // 字段错误不登记；只有真正撞单才进冲突清单并保留原排班
      if (evaluation.blockers.length === 0) {
        return { ok: false, errors: evaluation.errors, clashes: [] };
      }

      const seq = this.state.seq + 1;
      const recordId = `clash-${seq}`;
      const keptSchedule = existing ? this.describeSchedule(existing) : undefined;
      const record: ClashRecord = {
        id: recordId,
        at: new Date().toISOString(),
        orderNo: draft.orderNo,
        itemName: draft.itemName,
        priority: draft.priority,
        attemptDate: draft.date,
        kind: existing && existing.status !== "pending" ? "reschedule" : "new",
        blockers: evaluation.blockers.map((c) => this.clashLine(c)),
        keptSchedule,
        resolved: false,
      };
      this.commit({
        ...this.state,
        seq,
        clashes: [record, ...this.state.clashes],
      });
      return {
        ok: false,
        errors: evaluation.errors,
        clashes: evaluation.blockers,
        recordId,
        keptSchedule,
      };
    }

    // 校验通过：急件顶掉可顶的普通任务（回到待安排并登记原因）
    const bumpedIds = new Set(evaluation.bumpableTasks.map((t) => t.id));
    const bumpReason = `被急件 #${draft.orderNo}《${draft.itemName}》顶单（${draft.date} ${rangeLabel(draft.startSlot, draft.duration)}）`;
    const toPending = (t: Task): Task => ({
      ...t,
      status: "pending",
      masterId: undefined,
      stationId: undefined,
      date: undefined,
      startSlot: undefined,
      duration: undefined,
      bumpReason,
    });

    if (existing) {
      const tasks = this.state.tasks.map((t) => {
        if (t.id === existing.id) {
          return {
            ...t,
            orderNo: draft.orderNo.trim(),
            itemName: draft.itemName.trim(),
            priority: draft.priority,
            // 待安排单排上后变“已排班”；已开工单改期保留开工状态
            status: t.status === "pending" ? "scheduled" : t.status,
            masterId: draft.masterId,
            stationId: draft.stationId,
            date: draft.date,
            startSlot: draft.startSlot,
            duration: draft.duration,
            bumpReason: undefined,
          };
        }
        return bumpedIds.has(t.id) ? toPending(t) : t;
      });
      this.commit({ ...this.state, tasks });
      return { ok: true, taskId: existing.id, bumped: evaluation.bumpableTasks };
    }

    const seq = this.state.seq + 1;
    const taskId = `task-${seq}`;
    const tasks: Task[] = [
      ...this.state.tasks.map((t) => (bumpedIds.has(t.id) ? toPending(t) : t)),
      {
        id: taskId,
        orderNo: draft.orderNo.trim(),
        itemName: draft.itemName.trim(),
        priority: draft.priority,
        status: "scheduled",
        masterId: draft.masterId,
        stationId: draft.stationId,
        date: draft.date,
        startSlot: draft.startSlot,
        duration: draft.duration,
      },
    ];
    this.commit({ ...this.state, seq, tasks });
    return { ok: true, taskId, bumped: evaluation.bumpableTasks };
  }

  /** 待安排池直接新建工单（不排期）。 */
  addPending(input: { orderNo: string; itemName: string; priority: Priority }): string {
    const seq = this.state.seq + 1;
    const id = `task-${seq}`;
    const task: Task = {
      id,
      orderNo: input.orderNo.trim(),
      itemName: input.itemName.trim(),
      priority: input.priority,
      status: "pending",
    };
    this.commit({
      ...this.state,
      seq,
      tasks: [...this.state.tasks, task],
    });
    return id;
  }

  /** 手动释放回待安排（撤销排班，或改期/换人时先腾空）。 */
  releaseToPending(taskId: string, reason: string) {
    const tasks = this.state.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: "pending" as const,
            masterId: undefined,
            stationId: undefined,
            date: undefined,
            startSlot: undefined,
            duration: undefined,
            bumpReason: reason.trim() || t.bumpReason,
          }
        : t,
    );
    this.commit({ ...this.state, tasks });
  }

  setStatus(taskId: string, status: Task["status"]) {
    const tasks = this.state.tasks.map((t) => (t.id === taskId ? { ...t, status } : t));
    this.commit({ ...this.state, tasks });
  }

  removeTask(taskId: string) {
    this.commit({
      ...this.state,
      tasks: this.state.tasks.filter((t) => t.id !== taskId),
    });
  }

  resolveClash(clashId: string) {
    this.commit({
      ...this.state,
      clashes: this.state.clashes.map((c) =>
        c.id === clashId ? { ...c, resolved: true } : c,
      ),
    });
  }

  removeClash(clashId: string) {
    this.commit({
      ...this.state,
      clashes: this.state.clashes.filter((c) => c.id !== clashId),
    });
  }

  resetDemo() {
    this.commit({ tasks: seedTasks(), clashes: [], seq: 0 });
  }

  // —— 提示文案 ——

  private describeSchedule(t: Task): string {
    if (!t.date || t.startSlot === undefined || t.duration === undefined) {
      return "待安排";
    }
    return `${t.date} ${rangeLabel(t.startSlot, t.duration)}｜${masterName(t.masterId)} / ${stationName(t.stationId)}`;
  }

  private clashLine(clash: Clash): string {
    const t = clash.task;
    const where =
      clash.kind === "master"
        ? `师傅「${masterName(t.masterId)}」`
        : `工位「${stationName(t.stationId)}」`;
    const stateTag =
      t.status === "started"
        ? "，对方已开工不可顶"
        : t.priority === "rush"
          ? "，对方同为急件不可顶"
          : "";
    return `${where}与 #${t.orderNo}《${t.itemName}》（${t.date} ${rangeLabel(t.startSlot ?? 0, t.duration ?? 0)}）冲突${stateTag}`;
  }
}

export const schedulerStore = new SchedulerStore();
