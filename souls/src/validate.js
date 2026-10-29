// POST /api/optimize 요청 본문 검증
// 원칙: 모르는 필드는 거부한다. 조용히 무시하면 오타가 "왜 결과가 이상하지?"로 돌아온다.

"use strict";
 
const { OBJECTIVE_KEYS } = require("./engine");
 
const ALLOWED = ["budget", "level", "weights", "minPoise"];
 
function parseOptimizeQuery(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: ["요청 본문은 JSON 객체여야 합니다"] };
  }
  for (const k of Object.keys(body)) if (!ALLOWED.includes(k)) errors.push(`알 수 없는 필드: ${k}`);
 
  const { budget, level = 10, weights, minPoise = 0 } = body;
 
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0 || budget > 500)
    errors.push("budget 은 0 초과 500 이하의 숫자여야 합니다");
  if (!Number.isInteger(level) || level < 0 || level > 10)
    errors.push("level 은 0~10 정수여야 합니다");
  if (!Number.isInteger(minPoise) || minPoise < 0 || minPoise > 500)
    errors.push("minPoise 는 0~500 정수여야 합니다");
 
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    errors.push(`weights 객체가 필요합니다 (사용 가능: ${OBJECTIVE_KEYS.join(", ")})`);
  } else {
    let positive = 0;
    for (const [k, v] of Object.entries(weights)) {
      if (!OBJECTIVE_KEYS.includes(k)) { errors.push(`알 수 없는 가중치: ${k}`); continue; }
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)
        errors.push(`weights.${k} 는 0~100 숫자여야 합니다`);
      else if (v > 0) positive++;
    }
    if (positive === 0) errors.push("양수 가중치가 최소 하나는 있어야 합니다");
  }
 
  if (errors.length) return { errors };
  return { query: { budget, level, weights, minPoise } };
}
 
module.exports = { parseOptimizeQuery };