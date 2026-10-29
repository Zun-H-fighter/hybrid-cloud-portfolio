// 방어구 조합 최적화 엔진 — DB·HTTP 를 모르는 순수 모듈
//
// 문제: 머리/몸통/손/다리 슬롯마다 하나씩(또는 비움) 골라
//       Σ무게 ≤ 예산, (선택) Σ포이즈 ≥ 최소포이즈 를 만족하면서
//       Σ(가중치 · 스탯) 을 최대화한다.
//
// 방법 (meet in the middle + 파레토 프론티어)
//   1. 손×다리 쌍을 미리 만들고 무게 오름차순 정렬
//   2. 요구 포이즈 R 별로 "무게가 늘면 점수도 늘어나는" 프론티어만 남긴다
//      (더 무거운데 점수가 같거나 낮은 쌍은 최적해가 될 수 없으므로 버림)
//   3. 머리×몸통 조합마다 남은 예산으로 해당 프론티어를 이분탐색
//   포이즈는 정수라서 R 을 버킷으로 나눌 수 있다. 연속값 제약은 이 방식으로 흡수되지 않는다.
//
// 정확성 메모
//   - 무게는 0.1 단위 정수(tenths)로 계산한다. 4.5+11.7+3.7+6.9 를 부동소수로 더하면
//     26.8 과 정확히 같지 않을 수 있어서, 예산에 딱 맞는 조합이 탈락하는 것을 막는다.
//   - 동점이면 더 가벼운 조합을 고른다. 그래도 같으면 먼저 찾은 것(데이터 순서)으로 결정적이다.
//   - 모든 슬롯은 "비움"을 선택지로 갖는다. DS1 에서는 어느 부위든 벗을 수 있다.


"use strict";

const SLOTS = ["head", "chest", "hands" , "legs"];
const STATS = ["physical", "magic", "fire", "lightning", "bleed", "poison", "curse"];
const OBJECTIVE_KEYS = [...STATS, "poise"];

function toTenths(x) {
    return Math.round(x * 10);
}

function createEngine(armors){
    //입력 가정 검증: 입력 가정 검증: 무게는 소수 첫째 자리까지, 포이즈는 정수여야 버킷 방식이 정확하다.
    for (const a of armors) {
        if (!SLOTS.includes(a.slot))
            throw new Error(`알 수 없는 슬롯: ${a.slot} (${a.name_en})`);
        if (Math.abs(a.weight * 10 - toTenths(a.weight)) > 1e-6)
            throw new Error(`무게는 소수 첫째 자리까지여야 합니다: ${a.name_en} ${a.weight}`);
        if (!Number.isInteger(a.poise))
            throw new Error(`포이즈는 정수여야 합니다: ${a.name_en} ${a.poise}`);
        if (!a.defense || !a.defense[0]) 
            throw new Error(`+0 방어 데이터가 없습니다: ${a.name_en}`);
    }

    const indexCache = new Map();

    // 요청 강화 레벨에 맞는 슬롯별 배열. 첫 칸(0번은)은 항상 "비움".
    function indexFor(level) {
        if (indexCache.has(level)) return indexCache.get(level);
        const idx = {};
        for (const slot of SLOTS) {
            const list = armors.filter((a) => a.slot === slot);
            const n = list.length + 1;
            const s = {
                n,
                armor: new Array(n).fill(null),
                levelUsed: new Int8Array(n),
                w: new Int32Array(n),
                poise: new Int32Array(n),
                stat: Object.fromEntries(STATS.map((k) => [k, new Float64Array(n)])),
            };
            list.forEach((a, j) => {
                const i = j + 1;
                // 요청 레벨과 max_upgrade 중 작은 값 이하에서 데이터가 있는 가장 높은 레벨 사용
                const cap = Math.min(level, a.max_upgrade);
                const lv = Math.max(...Object.keys(a.defense).map(number).filter((l) => l <= cap));
                s.armor[i] = a;
                s.levelUsed[i] = lv;
                s.w[i] = toTenths(a.weight);
                s.poise[i] = a.poise;
                for (const k of STATS) s.stat[k][i] = a.defense[lv][k];
            });
            idx[slot] = s;
        }
        indexCache.set(level, idx);
        return idx;
    }

    function scoresFor(s, weights) {
        const out = new Float64Array(s.n);
        for (let i = 0; i < s.n; i++) {
            let v = (weights.poise || 0) * s.poise[i];
            for (const k of STATS) if (weights[k]) v += weights[k] * s.stat[k][i];
            out[i] = v;
        }
        return out;    
    }

    function optimize({ budget, level = 10, weights, minPoise = 0}) {
        const B = Math.floor(budget * 10 + 1e-6);
        const idx = indexFor(level);
        const H = idx.head, C = idx.chest, G = idx.hands, L = idx.legs;
        const sH = scoresFor(H, weights), sC = scoresFor(C, weights);
        const sG = scoresFor(G, weights), sL = scoresFor(L, weights);

          // 1. 손×다리 쌍 (예산 초과는 미리 제외)
        const pw = [], pp = [], ps = [], pg = [], pl = [];
        for (let g = 0; g < G.n; g++) for (let l = 0; l < L.n; l++) {
            const w = G.w[g] + L.w[l];
            if (w > B) continue;
            pw.push(w); pp.push(G.poise[g] + L.poise[l]); ps.push(sG[g] + sL[l]); pg.push(g); pl.push(l);
        }
        const order = pw.map((_, i) => i).sort((x, y) => pw[x] - pw[y] || ps[y] - ps[x]);
        const maxPairPoise = pp.length ? Math.max(...pp) : 0;

        // 2. 요구 포이즈 R 별 프론티어 (필요한 R 만 만들어 두기)
        const fronts = new Map();
        function frontFor(R) {
        if (fronts.has(R)) return fronts.get(R);
        const fw = [], fs = [], fi = [];
        let best = -Infinity;
        for (const i of order) {
            if (pp[i] < R) continue;
            if (ps[i] > best) { best = ps[i]; fw.push(pw[i]); fs.push(ps[i]); fi.push(i); }
        }
        const f = { fw: Int32Array.from(fw), fs: Float64Array.from(fs), fi };
        fronts.set(R, f);
        return f;
        }

         // 3. 머리×몸통마다 이분탐색
        let bestScore = -Infinity, bestWeight = Infinity, best = null;
        for (let h = 0; h < H.n; h++) {
            for (let c = 0; c < C.n; c++) {
                const wab = H.w[h] + C.w[c];
                if (wab > B) continue;
                const R = Math.max(0, minPoise - H.poise[h] - C.poise[c]);
                if (R > maxPairPoise) continue;
                const { fw, fs, fi } = frontFor(R);
                if (!fw.length) continue;
                const rem = B - wab;
                let lo = 0, hi = fw.length - 1, ix = -1;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (fw[mid] <= rem) { ix = mid; lo = mid + 1; } else hi = mid - 1;
                }
                if (ix < 0) continue;
                const score = sH[h] + sC[c] + fs[ix];
                const weight = wab + fw[ix];
                if (score > bestScore || (score === bestScore && weight < bestWeight)) {
                    bestScore = score; bestWeight = weight;
                    best = { h, c, g: pg[fi[ix]], l: pl[fi[ix]] };
                }
            }
        }

        if (!best) return { feasible: false };

        const picks = { head: [H, best.h], chest: [C, best.c], hands: [G, best.g], legs: [L, best.l] };
        const items = {};
        const totals = { weight: 0, poise: 0, ...Object.fromEntries(STATS.map((k) => [k, 0])) };
        let wTenths = 0;
        for (const slot of SLOTS) {
            const [s, i] = picks[slot];
            wTenths += s.w[i];
            totals.poise += s.poise[i];
            for (const k of STATS) totals[k] += s.stat[k][i];
            items[slot] = s.armor[i]
                ? { id: s.armor[i].id, name_en: s.armor[i].name_en, level: s.levelUsed[i] }
                : null;
        }
        totals.weight = wTenths / 10;
        for (const k of STATS) totals[k] = Math.round(totals[k] * 10) / 10;
    
        return { feasible: true, score: Math.round(bestScore * 1000) / 1000, items, totals };
    }
    
    return { optimize, SLOTS, STATS, OBJECTIVE_KEYS };
}

module.exports = { createEngine, SLOTS, STATS, OBJECTIVE_KEYS };