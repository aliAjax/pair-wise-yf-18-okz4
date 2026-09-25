// 存档：待安排、今日排班、冲突清单共用一份本地数据（localStorage）。
// 每次变更整体写入，重开页面后原样恢复，可继续调整。

import type { BoardState } from "./rules";

const KEY = "inlay-scheduler:v1";

// 首次打开的示例盘面：两单已排（其中一单已开工，演示急件顶不动），其余待安排
export function seedState(): BoardState {
  return {
    tasks: [
      {
        id: "RX-1001",
        title: "祖母绿戒指·主石爪镶",
        urgent: false,
        status: "scheduled",
        masterId: "m1",
        stationId: "s1",
        start: "09:30",
        durationMin: 120,
        bumpReason: null,
      },
      {
        id: "RX-1002",
        title: "钻石婚戒·围石微镶",
        urgent: false,
        status: "in_progress",
        masterId: "m2",
        stationId: "s2",
        start: "09:00",
        durationMin: 180,
        bumpReason: null,
      },
      {
        id: "RX-1003",
        title: "翡翠胸针·包镶",
        urgent: false,
        status: "scheduled",
        masterId: "m3",
        stationId: "s3",
        start: "13:00",
        durationMin: 150,
        bumpReason: null,
      },
      {
        id: "RX-1004",
        title: "蓝宝石吊坠·包镶急修",
        urgent: true,
        status: "pending",
        masterId: null,
        stationId: null,
        start: null,
        durationMin: 90,
        bumpReason: null,
      },
      {
        id: "RX-1005",
        title: "珍珠耳钉·群镶",
        urgent: false,
        status: "pending",
        masterId: null,
        stationId: null,
        start: null,
        durationMin: 60,
        bumpReason: null,
      },
      {
        id: "RX-1006",
        title: "红宝石戒指·改圈补石",
        urgent: false,
        status: "pending",
        masterId: null,
        stationId: null,
        start: null,
        durationMin: 120,
        bumpReason: null,
      },
    ],
    logs: [],
  };
}

export function loadState(): BoardState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as BoardState;
    if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.logs)) {
      return seedState();
    }
    return parsed;
  } catch {
    // 数据损坏时回到示例盘面，不阻塞使用
    return seedState();
  }
}

export function saveState(state: BoardState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 隐私模式或存储满时静默失败，盘面仍在内存中可用
  }
}

export function resetState(): BoardState {
  const fresh = seedState();
  saveState(fresh);
  return fresh;
}
