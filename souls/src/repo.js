// DB → 엔진 입력 형태로 변환. 부팅 때 한 번만 호출된다.
 
"use strict";
 
// pg 는 NUMERIC 을 정밀도 보존을 위해 문자열로 돌려준다 → 숫자로 바꿔야 한다
const num = (v) => (v === null ? null : Number(v));
 
async function loadArmor(pool) {
  const { rows } = await pool.query(`
    SELECT a.id, a.name_en, a.name_ko, a.slot, a.set_name, a.weight, a.poise, a.max_upgrade,
           d.upgrade_level, d.physical, d.strike, d.slash, d.thrust,
           d.magic, d.fire, d.lightning, d.bleed, d.poison, d.curse
      FROM armor a
      JOIN armor_defense d ON d.armor_id = a.id
     ORDER BY a.id, d.upgrade_level`);
 
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, {
        id: r.id, name_en: r.name_en, name_ko: r.name_ko, slot: r.slot, set_name: r.set_name,
        weight: num(r.weight), poise: num(r.poise), max_upgrade: r.max_upgrade, defense: {},
      });
    }
    byId.get(r.id).defense[r.upgrade_level] = {
      physical: num(r.physical), strike: num(r.strike), slash: num(r.slash), thrust: num(r.thrust),
      magic: num(r.magic), fire: num(r.fire), lightning: num(r.lightning),
      bleed: num(r.bleed), poison: num(r.poison), curse: num(r.curse),
    };
  }
  return [...byId.values()];
}
 
async function loadDataVersion(pool) {
  const { rows } = await pool.query("SELECT value FROM dataset_meta WHERE key = 'armor_version'");
  return rows[0]?.value ?? "unknown";
}
 
module.exports = { loadArmor, loadDataVersion };