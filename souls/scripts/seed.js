// data/ds1/armor.json → PostgreSQL 시딩
//
//   node scripts/seed.js           검증 + 스키마 적용 + 시딩
//   node scripts/seed.js --check   검증만 (DB 불필요, CI용)
//
// 원칙
//   - JSON 파일이 원본이다. DB는 런타임 복제본이다.
//   - 멱등: 몇 번을 돌려도 같은 상태가 된다.
//   - 전부 한 트랜잭션: 중간에 실패하면 아무것도 바뀌지 않는다.
//   - 데이터가 이상하면 넣지 않고 시끄럽게 죽는다.
 
const fs = require("fs");
const path = require("path");
 
const DATA_FILE = path.join(__dirname, "..", "data", "ds1", "armor.json");
const SCHEMA_FILE = path.join(__dirname, "..", "db", "schema.sql");
 
const SLOTS = ["head", "chest", "hands", "legs"];
const REQUIRED = ["physical", "magic", "fire", "lightning", "bleed", "poison", "curse"];
const OPTIONAL = ["strike", "slash", "thrust"];
const DEFENSE_FIELDS = [...REQUIRED, ...OPTIONAL];
 
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
 
// ── 검증 ────────────────────────────────────────────────────────────────
function validate(doc) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
 
  if (typeof doc.version !== "string" || !doc.version) err("root", "version 문자열이 필요합니다");
  if (!Array.isArray(doc.armor) || doc.armor.length === 0) {
    err("root", "armor 배열이 비어 있습니다");
    return errors;
  }
 
  const seen = new Set();
  for (const [i, a] of doc.armor.entries()) {
    const at = `armor[${i}] ${a.name_en ?? "(이름 없음)"}`;
 
    if (typeof a.name_en !== "string" || !a.name_en.trim()) err(at, "name_en 이 필요합니다");
    else if (seen.has(a.name_en)) err(at, "name_en 중복");
    else seen.add(a.name_en);
 
    if (!SLOTS.includes(a.slot)) err(at, `slot 은 ${SLOTS.join("/")} 중 하나여야 합니다 (받은 값: ${a.slot})`);
    if (!isNum(a.weight) || a.weight < 0) err(at, "weight 는 0 이상의 숫자여야 합니다");
    if (!isNum(a.poise) || a.poise < 0) err(at, "poise 는 0 이상의 숫자여야 합니다");
    if (!Number.isInteger(a.max_upgrade) || a.max_upgrade < 0 || a.max_upgrade > 10)
      err(at, "max_upgrade 는 0~10 정수여야 합니다");
 
    const levels = Object.keys(a.defense ?? {});
    if (!levels.includes("0")) err(at, "defense 에 +0 레벨이 반드시 있어야 합니다");
 
    const parsed = [];
    for (const lv of levels) {
      const n = Number(lv);
      if (!Number.isInteger(n) || n < 0 || n > a.max_upgrade) {
        err(at, `강화 레벨 "${lv}" 가 0~max_upgrade(${a.max_upgrade}) 범위를 벗어났습니다`);
        continue;
      }
      const d = a.defense[lv];
      for (const f of REQUIRED) if (!isNum(d?.[f])) err(`${at} +${n}`, `${f} 값이 필요합니다`);
      for (const f of OPTIONAL) if (d?.[f] !== null && !isNum(d?.[f])) err(`${at} +${n}`, `${f} 는 숫자 또는 null 이어야 합니다`);
      for (const f of Object.keys(d ?? {}))
        if (!DEFENSE_FIELDS.includes(f)) err(`${at} +${n}`, `알 수 없는 필드 "${f}" (오타?)`);
      parsed.push([n, d]);
    }
 
    // 단조성: 강화하면 방어·저항 수치가 줄어들 수 없다. 수기 입력 오타를 잡는다.
    parsed.sort((x, y) => x[0] - y[0]);
    for (let k = 1; k < parsed.length; k++) {
      const [lo, dl] = parsed[k - 1];
      const [hi, dh] = parsed[k];
      for (const f of DEFENSE_FIELDS) {
        if (isNum(dl?.[f]) && isNum(dh?.[f]) && dh[f] < dl[f])
          err(at, `${f}: +${hi}(${dh[f]}) 가 +${lo}(${dl[f]}) 보다 작습니다 — 오타 가능성`);
      }
    }
  }
  return errors;
}
 
// ── 시딩 ────────────────────────────────────────────────────────────────
async function seed(doc) {
  const { Pool } = require("pg");
  for (const k of ["DB_USER", "DB_PASSWORD", "DB_NAME"])
    if (!process.env[k]) throw new Error(`환경변수 ${k} 가 설정되지 않았습니다`);
 
  const pool = new Pool({
    host: process.env.DB_HOST || "db",
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
 
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(fs.readFileSync(SCHEMA_FILE, "utf8"));
 
    await client.query(
      `INSERT INTO dataset_meta (key, value) VALUES ('armor_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [doc.version]
    );
 
    let levelRows = 0;
    for (const a of doc.armor) {
      const { rows } = await client.query(
        `INSERT INTO armor (name_en, name_ko, slot, set_name, weight, poise, max_upgrade)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (name_en) DO UPDATE SET
           name_ko = EXCLUDED.name_ko, slot = EXCLUDED.slot, set_name = EXCLUDED.set_name,
           weight = EXCLUDED.weight, poise = EXCLUDED.poise, max_upgrade = EXCLUDED.max_upgrade
         RETURNING id`,
        [a.name_en, a.name_ko, a.slot, a.set_name, a.weight, a.poise, a.max_upgrade]
      );
      const armorId = rows[0].id;
 
      // 레벨 목록은 파일이 원본: 기존 행을 지우고 파일 내용으로 다시 채운다
      await client.query("DELETE FROM armor_defense WHERE armor_id = $1", [armorId]);
      for (const [lv, d] of Object.entries(a.defense)) {
        await client.query(
          `INSERT INTO armor_defense
             (armor_id, upgrade_level, physical, strike, slash, thrust,
              magic, fire, lightning, bleed, poison, curse)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [armorId, Number(lv), d.physical, d.strike, d.slash, d.thrust,
           d.magic, d.fire, d.lightning, d.bleed, d.poison, d.curse]
        );
        levelRows++;
      }
    }
 
    // 파일에 없는데 DB에 남아 있는 방어구 — 지우지는 않고 알린다 (공유된 빌드가 참조할 수 있음)
    const { rows: orphans } = await client.query(
      "SELECT name_en FROM armor WHERE NOT (name_en = ANY($1))",
      [doc.armor.map((a) => a.name_en)]
    );
 
    await client.query("COMMIT");
    console.log(`✓ 시딩 완료 — version ${doc.version}, 방어구 ${doc.armor.length}개, 레벨 행 ${levelRows}개`);
    if (orphans.length)
      console.warn(`⚠ 파일에 없는 방어구가 DB에 남아 있습니다: ${orphans.map((o) => o.name_en).join(", ")}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
 
// ── 실행 ────────────────────────────────────────────────────────────────
(async () => {
  const doc = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const errors = validate(doc);
  if (errors.length) {
    console.error(`✗ 데이터 검증 실패 (${errors.length}건):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log(`✓ 검증 통과 — 방어구 ${doc.armor.length}개`);
  if (process.argv.includes("--check")) return;
  await seed(doc);
})().catch((e) => {
  console.error("✗ 시딩 실패:", e.message);
  process.exit(1);
});
 

