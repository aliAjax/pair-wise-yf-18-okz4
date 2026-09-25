import { useMemo, useSyncExternalStore, useState } from "react";
import {
  DAY_SLOTS,
  MASTERS,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATIONS,
  clashText,
  durationLabel,
  evaluateDraft,
  isOccupying,
  masterName,
  rangeLabel,
  shiftDate,
  slotToTime,
  stationName,
  todayStr,
  type Priority,
  type Task,
} from "./schedulingRules";
import { schedulerStore, type ClashRecord } from "./schedulingStore";

interface FormState {
  id?: string;
  orderNo: string;
  itemName: string;
  priority: Priority;
  masterId: string;
  stationId: string;
  date: string;
  startSlot: number;
  duration: number;
}

// 本地 React 类型垫片下，内置元素事件参数需显式标注
type FieldChange = { target: { value: string } };
type CheckChange = { target: { checked: boolean } };

interface Flash {
  type: "ok" | "warn" | "err";
  lines: string[];
}

function emptyForm(date = todayStr()): FormState {
  return {
    orderNo: "",
    itemName: "",
    priority: "normal",
    masterId: "",
    stationId: "",
    date,
    startSlot: 0,
    duration: 2,
  };
}

function useScheduler() {
  return useSyncExternalStore(
    (onChange) => schedulerStore.subscribe(onChange),
    () => schedulerStore.getState(),
  );
}

export default function SchedulingBoard() {
  const state = useScheduler();
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [viewDate, setViewDate] = useState(todayStr());
  const [flash, setFlash] = useState<Flash | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const editingTask = form.id ? state.tasks.find((t) => t.id === form.id) : undefined;

  // 提交前的实时撞单预演：排除自身旧占用（= 先释放旧占用再校验）
  const preview = useMemo(() => {
    if (!form.masterId || !form.stationId) return null;
    const others = state.tasks.filter((t) => t.id !== form.id);
    return evaluateDraft(
      {
        id: form.id,
        orderNo: form.orderNo,
        itemName: form.itemName,
        masterId: form.masterId,
        stationId: form.stationId,
        date: form.date,
        startSlot: form.startSlot,
        duration: form.duration,
        priority: form.priority,
      },
      others,
    );
  }, [form, state.tasks]);

  const pendingTasks = state.tasks.filter((t) => t.status === "pending");
  const openClashes = state.clashes.filter((c) => !c.resolved);

  const dayTasks = state.tasks
    .filter((t) => isOccupying(t) && t.date === viewDate)
    .sort((a, b) => (a.startSlot ?? 0) - (b.startSlot ?? 0));

  const update = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  function submitSchedule() {
    const outcome = schedulerStore.schedule({
      id: form.id,
      orderNo: form.orderNo,
      itemName: form.itemName,
      masterId: form.masterId,
      stationId: form.stationId,
      date: form.date,
      startSlot: form.startSlot,
      duration: form.duration,
      priority: form.priority,
    });

    if (outcome.ok) {
      setViewDate(form.date);
      const lines = [`已排定 #${form.orderNo} ${form.date} ${rangeLabel(form.startSlot, form.duration)}`];
      if (outcome.bumped.length > 0) {
        lines.push(
          `急件顶回待安排 ${outcome.bumped.length} 单：` +
            outcome.bumped.map((t) => `#${t.orderNo}`).join("、") +
            "（顶单原因已登记在工单上）",
        );
      }
      setFlash({ type: "ok", lines });
      setForm(emptyForm(form.date));
    } else {
      const lines = [...outcome.errors];
      if (outcome.clashes.length > 0) {
        if (outcome.keptSchedule) {
          lines.push(`原排班保留：${outcome.keptSchedule}`);
        }
        lines.push(...outcome.clashes.map((c) => "冲突：" + clashText(c)));
        lines.push("已记入冲突清单");
      }
      setFlash({ type: "err", lines });
    }
  }

  function submitPending() {
    if (!form.orderNo.trim() || !form.itemName.trim()) {
      setFlash({ type: "err", lines: ["请先填写工单号和活儿名称"] });
      return;
    }
    schedulerStore.addPending({
      orderNo: form.orderNo,
      itemName: form.itemName,
      priority: form.priority,
    });
    setFlash({ type: "ok", lines: [`#${form.orderNo} 已加入待安排`] });
    setForm(emptyForm(form.date));
  }

  function fillFromTask(task: Task) {
    setFlash(null);
    setForm({
      id: task.id,
      orderNo: task.orderNo,
      itemName: task.itemName,
      priority: task.priority,
      masterId: task.masterId ?? "",
      stationId: task.stationId ?? "",
      date: task.date ?? viewDate,
      startSlot: task.startSlot ?? 0,
      duration: task.duration ?? 2,
    });
  }

  function manualRelease(task: Task) {
    const reason = window.prompt(
      `把 #${task.orderNo} 释放回待安排，登记原因（可留空）：`,
      "改期/换人，先腾空旧占用",
    );
    if (reason === null) return;
    schedulerStore.releaseToPending(task.id, reason);
    if (form.id === task.id) setForm(emptyForm(form.date));
    setFlash({ type: "ok", lines: [`#${task.orderNo} 已释放回待安排`] });
  }

  const previewBlockers = preview && form.priority === "normal" ? preview.clashes : preview?.blockers ?? [];
  const previewBumpable = form.priority === "rush" ? preview?.bumpableTasks ?? [] : [];
  const beyondDay = form.startSlot + form.duration > DAY_SLOTS;

  return (
    <main className="sched-app">
      <header className="sched-header">
        <div>
          <p className="eyebrow">镶嵌工坊 · 本地排产台</p>
          <h1>师傅 / 工位排产白板</h1>
          <p className="sub">
            待安排、排班与冲突清单都存在本机浏览器，重开页面可继续调整；不连后端。
          </p>
        </div>
        <div className="header-stats">
          <Stat label="待安排" value={pendingTasks.length} tone="amber" />
          <Stat label={viewDate === todayStr() ? "今日已排" : "当日已排"} value={dayTasks.length} tone="teal" />
          <Stat
            label="开工中"
            value={dayTasks.filter((t) => t.status === "started").length}
            tone="rose"
          />
          <Stat label="未处理冲突" value={openClashes.length} tone="ink" />
        </div>
      </header>

      <div className="sched-grid">
        {/* —— 排产表单（规则、存档、界面三分开，这里只管交互） —— */}
        <section className="card form-card">
          <div className="card-head">
            <h2>{editingTask ? "改期 / 换人" : "新排一件活儿"}</h2>
            {editingTask && (
              <button className="link-btn" onClick={() => setForm(emptyForm(form.date))}>
                取消编辑
              </button>
            )}
          </div>

          {editingTask && (
            <div className="edit-banner">
              正在改单 <b>#{editingTask.orderNo}</b>
              {editingTask.status !== "pending" && (
                <>
                  ，原占用：
                  {editingTask.date} {rangeLabel(editingTask.startSlot ?? 0, editingTask.duration ?? 0)} ·{" "}
                  {masterName(editingTask.masterId)} / {stationName(editingTask.stationId)}
                  。校验时会先释放旧占用，若被撞则保留原排班。
                </>
              )}
            </div>
          )}

          <label className="field">
            <span>工单号</span>
            <input
              value={form.orderNo}
              placeholder="如 JD-1042"
              onChange={(e: FieldChange) => update({ orderNo: e.target.value })}
            />
          </label>
          <label className="field">
            <span>活儿名称</span>
            <input
              value={form.itemName}
              placeholder="如 18K 钻戒六爪镶主石"
              onChange={(e: FieldChange) => update({ itemName: e.target.value })}
            />
          </label>

          <div className="seg-field">
            <span className="field-label">急缓</span>
            <div className="segmented">
              {(["normal", "rush"] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={form.priority === p ? "on" : ""}
                  onClick={() => update({ priority: p })}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
            {form.priority === "rush" && (
              <small className="hint">急件可顶掉“未开工的普通任务”，已开工/急件顶不动。</small>
            )}
          </div>

          <label className="field">
            <span>师傅</span>
            <select value={form.masterId} onChange={(e: FieldChange) => update({ masterId: e.target.value })}>
              <option value="">选择师傅…</option>
              {MASTERS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}（{m.title}）
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>工位</span>
            <select value={form.stationId} onChange={(e: FieldChange) => update({ stationId: e.target.value })}>
              <option value="">选择工位…</option>
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>日期</span>
            <input
              type="date"
              value={form.date}
              onChange={(e: FieldChange) => update({ date: e.target.value })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>开始时段</span>
              <select
                value={form.startSlot}
                onChange={(e: FieldChange) => update({ startSlot: Number(e.target.value) })}
              >
                {Array.from({ length: DAY_SLOTS }, (_, i) => (
                  <option key={i} value={i}>
                    {slotToTime(i)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>预计时长</span>
              <select
                value={form.duration}
                onChange={(e: FieldChange) => update({ duration: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 6, 8].map((d) => (
                  <option key={d} value={d}>
                    {durationLabel(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <small className={"hint " + (beyondDay ? "hint-err" : "")}>
            占用 {rangeLabel(form.startSlot, form.duration)}
            {beyondDay ? "（超出 20:00 收工，请调整）" : ""}
          </small>

          {/* 实时撞单预演 */}
          {preview && (
            <div className="preview">
              {previewBlockers.length > 0 && (
                <div className="preview-block">
                  <b>{form.priority === "rush" ? "顶不动，提交会被拒：" : "师傅/工位相撞，提交将保留原排班："}</b>
                  <ul>
                    {previewBlockers.map((c, i) => (
                      <li key={i}>{clashText(c)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {previewBumpable.length > 0 && (
                <div className="preview-warn">
                  <b>提交后将顶回待安排：</b>
                  <ul>
                    {previewBumpable.map((t) => (
                      <li key={t.id}>
                        #{t.orderNo}《{t.itemName}》{t.date} {rangeLabel(t.startSlot ?? 0, t.duration ?? 0)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {previewBlockers.length === 0 && previewBumpable.length === 0 && (
                <p className="preview-ok">该时段师傅与工位均空闲。</p>
              )}
            </div>
          )}

          <div className="form-actions">
            <button className="primary" onClick={submitSchedule} disabled={beyondDay}>
              {editingTask ? "保存改期/换人" : "确认排班"}
            </button>
            <button onClick={submitPending}>先放待安排</button>
          </div>

          {flash && (
            <div className={"flash flash-" + flash.type}>
              {flash.lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </section>

        {/* —— 右侧：今日排班 / 待安排 / 冲突清单 —— */}
        <div className="content-col">
          <section className="card">
            <div className="card-head">
              <h2>排班日历</h2>
              <div className="date-nav">
                <button onClick={() => setViewDate(shiftDate(viewDate, -1))}>‹ 前一天</button>
                <button onClick={() => setViewDate(todayStr())}>今天</button>
                <button onClick={() => setViewDate(shiftDate(viewDate, 1))}>后一天 ›</button>
                <input
                  type="date"
                  value={viewDate}
                  onChange={(e: FieldChange) => setViewDate(e.target.value)}
                />
              </div>
            </div>
            {dayTasks.length === 0 ? (
              <p className="empty">这一天还没有排班。</p>
            ) : (
              <ul className="task-list">
                {dayTasks.map((task) => (
                  <li key={task.id} className={"task-row status-" + task.status}>
                    <div className="time-col">
                      <b>{rangeLabel(task.startSlot ?? 0, task.duration ?? 1)}</b>
                      <span>{durationLabel(task.duration ?? 1)}</span>
                    </div>
                    <div className="task-main">
                      <div className="task-title">
                        <span className="order-no">#{task.orderNo}</span>
                        《{task.itemName}》
                        <span className={"tag tag-" + task.priority}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        <span className={"tag tag-" + task.status}>{STATUS_LABEL[task.status]}</span>
                      </div>
                      <div className="task-meta">
                        {masterName(task.masterId)} · {stationName(task.stationId)}
                      </div>
                    </div>
                    <div className="task-ops">
                      {task.status === "scheduled" && (
                        <>
                          <button onClick={() => schedulerStore.setStatus(task.id, "started")}>
                            开工
                          </button>
                          <button onClick={() => fillFromTask(task)}>改期/换人</button>
                          <button onClick={() => manualRelease(task)}>释放</button>
                        </>
                      )}
                      {task.status === "started" && (
                        <>
                          <button className="primary-ghost" onClick={() => schedulerStore.setStatus(task.id, "done")}>
                            完工
                          </button>
                          <button onClick={() => fillFromTask(task)}>改期/换人</button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>待安排（{pendingTasks.length}）</h2>
              <span className="muted">点“排入日程”把信息带进左侧表单</span>
            </div>
            {pendingTasks.length === 0 ? (
              <p className="empty">没有待安排的活儿。</p>
            ) : (
              <ul className="task-list">
                {pendingTasks.map((task) => (
                  <li key={task.id} className="task-row status-pending">
                    <div className="task-main">
                      <div className="task-title">
                        <span className="order-no">#{task.orderNo}</span>
                        《{task.itemName}》
                        <span className={"tag tag-" + task.priority}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                      </div>
                      {task.bumpReason && <div className="bump-reason">回池原因：{task.bumpReason}</div>}
                    </div>
                    <div className="task-ops">
                      <button className="primary-ghost" onClick={() => fillFromTask(task)}>
                        排入日程
                      </button>
                      <button onClick={() => schedulerStore.removeTask(task.id)}>删除</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>冲突清单（{openClashes.length} 未处理）</h2>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e: CheckChange) => setShowResolved(e.target.checked)}
                />
                显示已处理
              </label>
            </div>
            <ClashList
              records={state.clashes.filter((c) => showResolved || !c.resolved)}
            />
          </section>

          <section className="card rules-card">
            <h2>排产规则</h2>
            <ul>
              <li>同一师傅、同一工位在半小时时段上不可重叠；首尾相接（如 09:00 接 09:00）不算撞。</li>
              <li>普通任务相撞：保留原排班不动，本次尝试记入冲突清单，并注明与哪一单在师傅/工位上冲突。</li>
              <li>急件只可顶掉“未开工的普通任务”；被顶单回到待安排，原因自动登记在工单上。</li>
              <li>已开工、同为急件、跨资源无关的单顶不动，急件排期会被拦下并记录。</li>
              <li>改期或换人：校验时先释放该单旧占用，成功才覆盖；被撞则原排班原样保留。</li>
              <li>数据只存本机浏览器（localStorage），三块视图共用一份，重开仍可调整。</li>
            </ul>
            <button
              className="link-btn danger"
              onClick={() => {
                if (window.confirm("恢复演示数据？当前所有排期与冲突记录将清空。")) {
                  schedulerStore.resetDemo();
                  setForm(emptyForm());
                  setViewDate(todayStr());
                  setFlash(null);
                }
              }}
            >
              恢复演示数据
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={"stat stat-" + tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ClashList({ records }: { records: ClashRecord[] }) {
  if (records.length === 0) {
    return <p className="empty">暂无冲突记录。</p>;
  }
  return (
    <ul className="clash-list">
      {records.map((c) => (
        <li key={c.id} className={"clash-row " + (c.resolved ? "is-resolved" : "")}>
          <div className="clash-head">
            <span className="order-no">#{c.orderNo}</span>
            《{c.itemName}》
            <span className={"tag tag-" + c.priority}>{PRIORITY_LABEL[c.priority]}</span>
            <span className="tag tag-clash">
              {c.kind === "reschedule" ? "改期被拦·原排班保留" : "排期被拦"}
            </span>
            {c.resolved && <span className="tag tag-done">已处理</span>}
            <span className="clash-time">
              {new Date(c.at).toLocaleString("zh-CN", { hour12: false })}
            </span>
          </div>
          <ul className="clash-detail">
            {c.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          {c.keptSchedule && <div className="kept">保留的原排班：{c.keptSchedule}</div>}
          {!c.resolved && (
            <div className="task-ops">
              <button className="primary-ghost" onClick={() => schedulerStore.resolveClash(c.id)}>
                标记已处理
              </button>
              <button onClick={() => schedulerStore.removeClash(c.id)}>删除记录</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
