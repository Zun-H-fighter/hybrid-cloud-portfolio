// node --test
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createEngine, SLOTS, STATS } = require("../src/engine");
const { parseOptimizeQuery } = require("../src/validate");

// ── 실제 데이터(Elite Knight 한 세트)로 손 계산한 기댓값 ──────────────────
const doc = require(path.join(__dirname, "..", "data", "ds1", "armor.json"));
const EK = doc.armor.map((a, i) => ({
  ...a,
  id: i + 1,
  defense: Object.fromEntries(Object.entries(a.defense).map(([lv, d]) => [Number(lv), d])),
}));
const ek = createEngine(EK);
const PHYS = { physical: 1 };

// +10 물리: 투구 36.3(4.5) 갑옷 94.4(11.7) 장갑 43.6(3.7) 각반 55.7(6.9) / 포이즈 6,15,4,9
test("예산이 세트 무게와 정확히 같으면 전부 입는다 (부동소수 오차로 탈락하지 않음)", () => {
  const r = ek.optimize({ budget: 26.8, level: 10, weights: PHYS });
  assert.equal(r.totals.weight, 26.8);
  assert.equal(r.totals.physical, 230);
  for (const s of SLOTS) assert.ok(r.items[s], `${s} 가 비어 있음`);
});

test("0.1 모자라면 물리 손실이 가장 작은 투구를 벗는다", () => {
  const r = ek.optimize({ budget: 26.7, level: 10, weights: PHYS });
  assert.equal(r.items.head, null);
  assert.equal(r.totals.physical, 193.7);
  assert.equal(r.totals.weight, 22.3);
});

test("포이즈 하한이 붙으면 답이 바뀐다: 투구 대신 장갑을 벗는다", () => {
  // 투구를 벗으면 포이즈 28 < 30 이라 불가 → 장갑을 벗어야 포이즈 30 유지
  const r = ek.optimize({ budget: 26.7, level: 10, weights: PHYS, minPoise: 30 });
  assert.equal(r.items.hands, null);
  assert.ok(r.items.head);
  assert.equal(r.totals.poise, 30);
  assert.equal(r.totals.physical, 186.4);
});

test("달성 불가능한 포이즈 하한이면 feasible: false", () => {
  const r = ek.optimize({ budget: 100, level: 10, weights: PHYS, minPoise: 35 }); // 세트 합계 34
  assert.equal(r.feasible, false);
});

test("아무것도 못 입는 예산이면 전부 비운 조합이 답이다", () => {
  const r = ek.optimize({ budget: 0.1, level: 10, weights: PHYS });
  assert.equal(r.feasible, true);
  for (const s of SLOTS) assert.equal(r.items[s], null);
  assert.equal(r.totals.weight, 0);
});

test("강화 레벨에 따라 +0 수치를 쓴다", () => {
  const r = ek.optimize({ budget: 100, level: 0, weights: PHYS });
  assert.equal(r.totals.physical, 15 + 39 + 18 + 23);
  assert.equal(r.items.head.level, 0);
});

test("데이터에 없는 중간 레벨은 그 이하에서 가장 높은 레벨로 대체한다", () => {
  const r = ek.optimize({ budget: 100, level: 5, weights: PHYS }); // +0, +10 만 있음 → +0
  assert.equal(r.items.head.level, 0);
});

// ── 무작위 데이터로 완전탐색과 대조 ─────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomArmor(r, perSlot) {
  const out = [];
  let id = 1;
  for (const slot of SLOTS) for (let i = 0; i < perSlot; i++) {
    const d0 = Object.fromEntries(STATS.map((k) => [k, Math.round(r() * 300) / 10]));
    out.push({
      id: id++, name_en: `${slot}-${i}`, slot,
      weight: Math.round(r() * 150) / 10, // 0.0 ~ 15.0
      poise: Math.floor(r() * 20),
      max_upgrade: 10,
      defense: { 0: d0, 10: Object.fromEntries(STATS.map((k) => [k, d0[k] * 2])) },
    });
  }
  return out;
}

function bruteForce(armors, { budget, level, weights, minPoise }) {
  const B = Math.floor(budget * 10 + 1e-6);
  const bySlot = SLOTS.map((s) => [null, ...armors.filter((a) => a.slot === s)]);
  const val = (a) => {
    if (!a) return { w: 0, p: 0, s: 0 };
    const d = a.defense[level >= 10 ? 10 : 0];
    let s = (weights.poise || 0) * a.poise;
    for (const k of STATS) s += (weights[k] || 0) * d[k];
    return { w: Math.round(a.weight * 10), p: a.poise, s };
  };
  let best = -Infinity;
  for (const a of bySlot[0]) for (const b of bySlot[1]) for (const c of bySlot[2]) for (const d of bySlot[3]) {
    const v = [a, b, c, d].map(val);
    const w = v.reduce((x, y) => x + y.w, 0);
    const p = v.reduce((x, y) => x + y.p, 0);
    if (w > B || p < minPoise) continue;
    const s = v.reduce((x, y) => x + y.s, 0);
    if (s > best) best = s;
  }
  return best;
}

test("무작위 300건: 엔진 최적값이 완전탐색과 일치하고, 고른 조합이 제약을 만족한다", () => {
  const r = rng(20260929);
  const armors = randomArmor(r, 9); // 슬롯당 9개 + 비움 → 10⁴ 조합
  const eng = createEngine(armors);
  const byId = new Map(armors.map((a) => [a.id, a]));

  for (let t = 0; t < 300; t++) {
    const q = {
      budget: Math.round((5 + r() * 45) * 10) / 10,
      level: r() < 0.5 ? 0 : 10,
      weights: Object.fromEntries(
        [...STATS, "poise"].filter(() => r() < 0.5).map((k) => [k, Math.round(r() * 30) / 10])
      ),
      minPoise: r() < 0.5 ? 0 : Math.floor(r() * 50),
    };
    if (!Object.values(q.weights).some((v) => v > 0)) q.weights.physical = 1;

    const expected = bruteForce(armors, q);
    const got = eng.optimize(q);
    const ctx = JSON.stringify(q);

    assert.equal(got.feasible, expected !== -Infinity, `feasible 불일치 ${ctx}`);
    if (!got.feasible) continue;

    // 엔진이 고른 조합을 원본 데이터로 다시 계산해서 검증 (엔진 내부 값을 믿지 않는다)
    let w = 0, p = 0, s = 0;
    for (const slot of SLOTS) {
      const it = got.items[slot];
      if (!it) continue;
      const a = byId.get(it.id);
      assert.equal(a.slot, slot, `슬롯 불일치 ${ctx}`);
      const d = a.defense[it.level];
      w += Math.round(a.weight * 10); p += a.poise;
      s += (q.weights.poise || 0) * a.poise;
      for (const k of STATS) s += (q.weights[k] || 0) * d[k];
    }
    assert.ok(w <= Math.floor(q.budget * 10 + 1e-6), `무게 초과 ${ctx}`);
    assert.ok(p >= q.minPoise, `포이즈 미달 ${ctx}`);
    assert.ok(Math.abs(s - expected) < 1e-6, `최적값 불일치: 엔진 ${s} vs 완전탐색 ${expected} ${ctx}`);
  }
});

// ── 입력 검증 ───────────────────────────────────────────────────────────
test("검증: 정상 요청은 통과하고 기본값이 채워진다", () => {
  const { errors, query } = parseOptimizeQuery({ budget: 30, weights: { physical: 1 } });
  assert.equal(errors, undefined);
  assert.deepEqual(query, { budget: 30, level: 10, weights: { physical: 1 }, minPoise: 0 });
});

test("검증: 오타 필드·잘못된 값은 전부 모아서 거부한다", () => {
  const { errors } = parseOptimizeQuery({
    budgt: 30, level: 11, minPoise: 1.5, weights: { physcal: 1, fire: -1 },
  });
  const all = errors.join("\n");
  for (const frag of ["budgt", "budget", "level", "minPoise", "physcal", "weights.fire", "양수 가중치"])
    assert.ok(all.includes(frag), `"${frag}" 에 대한 오류가 없음:\n${all}`);
});