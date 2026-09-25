// 界面：排产台。规则见 rules.ts，存档见 storage.ts。
import { useEffect, useMemo, useState } from "react";
import {
  addTask,
  applySchedule,
  BoardState,
  clearLogs,
  DAY_CLOSE,
  DAY_OPEN,
  DURATION_OPTIONS,
  durationLabel,
  endOf,
  finishTask,
  MASTERS,
  releaseTask,
  startTask,
  STATIONS,
  Task,
  TaskStatus,
} from "./rules";
import { loadState, resetState, saveState } from "./storage";
import "./styles.css";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待安排",
  scheduled: "已排班",
  in_progress: "进行中",
  done: "已完工",
};

function fmtLogTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const todayText = new Date().toLocaleDateString("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

function App() {
  const [state, setState] = useState<BoardState>(loadState);
  // 排产表单：选中的工单 + 目标时段
  const [selectedId, setSelectedId] = useState<string>("");
  const [masterId, setMasterId] = useState<string>(MASTERS[0].id);
  const [stationId, setStationId] = useState<string>(STATIONS[0].id);
  const [start, setStart] = useState<string>(DAY_OPEN);
  const [durationMin, setDurationMin] = useState<number>(60);
  // 新增工单表单
  const [newTitle, setNewTitle] = useState("");
  const [newUrgent, setNewUrgent] = useState(false);
  const [newDuration, setNewDuration] = useState(60);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 任何变更都写回本地存档，重开页面可继续调整
  useEffect(() => {
    saveState(state);
  }, [state]);

  const pending = useMemo(() => state.tasks.filter((t) => t.status === "pending"), [state.tasks]);
  const today = useMemo(
    () =>
      state.tasks
        .filter((t) => t.status !== "pending")
        .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")),
    [state.tasks]
  );
  const inProgress = today.filter((t) => t.status === "in_progress").length;
  const selected = state.tasks.find((t) => t.id === selectedId) ?? null;

  // 把工单装入表单：待安排=新排班，已排班=改期/换人（预填原占用）
  function pickTask(task: Task) {
    setSelectedId(task.id);
    setMasterId(task.masterId ?? MASTERS[0].id);
    setStationId(task.stationId ?? STATIONS[0].id);
    setStart(task.start ?? DAY_OPEN);
    setDurationMin(task.durationMin);
    setNotice(null);
  }

  function handleSchedule() {
    if (!selected) {
      setNotice({ kind: "err", text: "请先从待安排或今日排班中选择工单" });
      return;
    }
    const result = applySchedule(state, selected.id, { masterId, stationId, start, durationMin });
    setState(result.state);
    setNotice({ kind: result.ok ? "ok" : "err", text: result.message });
    if (result.ok) setSelectedId("");
  }

  function handleAdd() {
    const result = addTask(state, newTitle, newUrgent, newDuration);
    setState(result.state);
    setNotice({ kind: result.ok ? "ok" : "err", text: result.message });
    if (result.ok) {
      setNewTitle("");
      setNewUrgent(false);
    }
  }

  function handleReset() {
    if (window.confirm("确定清空当前盘面并恢复示例数据吗？")) {
      setState(resetState());
      setSelectedId("");
      setNotice({ kind: "ok", text: "已恢复示例盘面" });
    }
  }

  return (
    <main className="app">
      <section className="hero">
        <p>镶嵌工坊 · 排产台 · {todayText}</p>
        <h1>师傅工位不撞单</h1>
        <span>
          选师傅、工位、时段和预计时长即可排班；师傅或工位相撞时保留原排班并指明撞了哪一单。
          急件只能顶掉未开工的普通任务，被顶任务自动回到待安排并记录原因；改期或换人先释放旧占用再校验。
        </span>
        <div className="hero-actions">
          <button onClick={handleReset}>恢复示例盘面</button>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>待安排</small>
          <strong>{pending.length}</strong>
        </article>
        <article>
          <small>今日已排</small>
          <strong>{today.filter((t) => t.status === "scheduled").length}</strong>
        </article>
        <article>
          <small>进行中</small>
          <strong>{inProgress}</strong>
        </article>
        <article>
          <small>冲突 / 顶单记录</small>
          <strong>{state.logs.length}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="side">
          <div className="panel">
            <div className="heading">
              <div>
                <p>排产台</p>
                <h2>{selected ? `安排「${selected.title}」` : "选择工单"}</h2>
              </div>
            </div>

            <div className="form-grid">
              <label>
                <span>工单（待安排 / 改期）</span>
                <select
                  value={selectedId}
                  onChange={(e) => {
                    const task = state.tasks.find((t) => t.id === e.target.value);
                    if (task) pickTask(task);
                    else setSelectedId("");
                  }}
                >
                  <option value="">请选择工单</option>
                  {pending.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.urgent ? "【急】" : ""}
                      {t.id} {t.title}
                    </option>
                  ))}
                  {selected && selected.status === "scheduled" && (
                    <option value={selected.id}>【改期】{selected.id} {selected.title}</option>
                  )}
                </select>
              </label>
              <label>
                <span>师傅</span>
                <select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
                  {MASTERS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}（{m.skill}）
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>工位</span>
                <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
                  {STATIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>时段（{DAY_OPEN}–{DAY_CLOSE}）</span>
                <input
                  type="time"
                  min={DAY_OPEN}
                  max={DAY_CLOSE}
                  step={900}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                <span>预计时长</span>
                <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {durationLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selected && (
              <p className="hint">
                {selected.urgent ? "急件：可顶掉未开工的普通任务。" : "普通任务：撞单将被拒并保留原排班。"}
                {selected.status === "scheduled" ? " 当前为改期/换人，提交时先释放旧占用再校验。" : ""}
              </p>
            )}

            <button className="primary block" onClick={handleSchedule} disabled={!selected}>
              {selected?.status === "scheduled" ? "确认改期" : "确认排班"}
            </button>

            {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
          </div>

          <div className="panel">
            <div className="heading">
              <div>
                <p>接单</p>
                <h2>新增工单</h2>
              </div>
            </div>
            <div className="form-grid">
              <label>
                <span>工单名称</span>
                <input
                  placeholder="如：蓝宝石吊坠·包镶"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </label>
              <label>
                <span>预计时长</span>
                <select value={newDuration} onChange={(e) => setNewDuration(Number(e.target.value))}>
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {durationLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={newUrgent}
                  onChange={(e) => setNewUrgent(e.target.checked)}
                />
                <span>急件（可顶未开工的普通任务）</span>
              </label>
            </div>
            <button className="block" onClick={handleAdd}>
              加入待安排
            </button>
          </div>
        </aside>

        <div className="main-col">
          <section className="panel">
            <div className="heading">
              <div>
                <p>队列</p>
                <h2>待安排（{pending.length}）</h2>
              </div>
            </div>
            {pending.length === 0 && <p className="empty">待安排为空，所有工单都已上台。</p>}
            <div className="cards">
              {pending.map((t) => (
                <article key={t.id} className={selectedId === t.id ? "card active" : "card"}>
                  <div className="card-main">
                    <h3>
                      {t.urgent && <em className="tag urgent">急件</em>}
                      {t.id} {t.title}
                    </h3>
                    <p>
                      预计 {durationLabel(t.durationMin)}
                      {t.bumpReason && <em className="tag bumped">{t.bumpReason}</em>}
                    </p>
                  </div>
                  <button onClick={() => pickTask(t)}>排班</button>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="heading">
              <div>
                <p>台面</p>
                <h2>今日排班（{today.length}）</h2>
              </div>
            </div>
            {today.length === 0 && <p className="empty">今日暂无排班。</p>}
            {today.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>时段</th>
                    <th>工单</th>
                    <th>师傅</th>
                    <th>工位</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {today.map((t) => (
                    <tr key={t.id} className={t.status === "done" ? "row-done" : ""}>
                      <td className="nowrap">
                        {t.start}–{t.start ? endOf(t.start, t.durationMin) : ""}
                      </td>
                      <td>
                        {t.urgent && <em className="tag urgent">急</em>} {t.id} {t.title}
                      </td>
                      <td>{MASTERS.find((m) => m.id === t.masterId)?.name}</td>
                      <td>{STATIONS.find((s) => s.id === t.stationId)?.name}</td>
                      <td>
                        <span className={`status ${t.status}`}>{STATUS_LABEL[t.status]}</span>
                      </td>
                      <td className="nowrap actions">
                        {t.status === "scheduled" && (
                          <>
                            <button
                              onClick={() => {
                                const r = startTask(state, t.id);
                                setState(r.state);
                                setNotice({ kind: r.ok ? "ok" : "err", text: r.message });
                              }}
                            >
                              开工
                            </button>
                            <button onClick={() => pickTask(t)}>改期</button>
                            <button
                              onClick={() => {
                                const r = releaseTask(state, t.id);
                                setState(r.state);
                                setNotice({ kind: r.ok ? "ok" : "err", text: r.message });
                              }}
                            >
                              退回
                            </button>
                          </>
                        )}
                        {t.status === "in_progress" && (
                          <button
                            onClick={() => {
                              const r = finishTask(state, t.id);
                              setState(r.state);
                              setNotice({ kind: r.ok ? "ok" : "err", text: r.message });
                            }}
                          >
                            完工
                          </button>
                        )}
                        {t.status === "done" && <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="heading">
              <div>
                <p>留痕</p>
                <h2>冲突清单（{state.logs.length}）</h2>
              </div>
              {state.logs.length > 0 && <button onClick={() => setState(clearLogs(state))}>清空记录</button>}
            </div>
            {state.logs.length === 0 && <p className="empty">暂无冲突或顶单记录。</p>}
            <div className="logs">
              {state.logs.map((log) => (
                <article key={log.id} className={`log ${log.kind}`}>
                  <em className={`tag ${log.kind}`}>{log.kind === "conflict" ? "冲突" : "顶单"}</em>
                  <div>
                    <time>{fmtLogTime(log.at)}</time>
                    <p>{log.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
