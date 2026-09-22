-- 다크소울 장비 최적화 앱 스키마 (멱등: 몇 번 실행해도 같은 결과)
 
-- 참조 데이터 버전 (build.data_version 과 비교용)
CREATE TABLE IF NOT EXISTS dataset_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
 
-- 강화해도 변하지 않는 값
CREATE TABLE IF NOT EXISTS armor (
  id          SERIAL PRIMARY KEY,
  name_en     TEXT NOT NULL UNIQUE,        -- 시딩 시 upsert 키. id 는 재시딩해도 유지된다
  name_ko     TEXT,                        -- 공식 한글명 확인 전까지 NULL 허용
  slot        TEXT NOT NULL CHECK (slot IN ('head','chest','hands','legs')),
  set_name    TEXT,
  weight      NUMERIC(5,1) NOT NULL CHECK (weight >= 0),
  poise       NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK (poise >= 0),
  max_upgrade SMALLINT NOT NULL DEFAULT 10 CHECK (max_upgrade BETWEEN 0 AND 10)
);
CREATE INDEX IF NOT EXISTS armor_slot_idx ON armor (slot);
 
-- 강화 레벨에 따라 변하는 값 (1:N)
CREATE TABLE IF NOT EXISTS armor_defense (
  armor_id      INT      NOT NULL REFERENCES armor(id) ON DELETE CASCADE,
  upgrade_level SMALLINT NOT NULL CHECK (upgrade_level BETWEEN 0 AND 10),
  physical  NUMERIC(6,1) NOT NULL,
  strike    NUMERIC(6,1),                  -- 현재 데이터 출처에 없음. 위키 대조 후 채움
  slash     NUMERIC(6,1),
  thrust    NUMERIC(6,1),
  magic     NUMERIC(6,1) NOT NULL,
  fire      NUMERIC(6,1) NOT NULL,
  lightning NUMERIC(6,1) NOT NULL,
  bleed     NUMERIC(6,1) NOT NULL,
  poison    NUMERIC(6,1) NOT NULL,
  curse     NUMERIC(6,1) NOT NULL,
  PRIMARY KEY (armor_id, upgrade_level)
);
 
-- 사용자 빌드 (저장 + 공유 링크)
CREATE TABLE IF NOT EXISTS build (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT     NOT NULL UNIQUE,
  params_hash  CHAR(64) NOT NULL UNIQUE,   -- 같은 입력 → 같은 slug (캐시 + 중복 제거)
  params       JSONB    NOT NULL,
  result       JSONB    NOT NULL,
  data_version TEXT     NOT NULL,
  view_count   INT      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS build_created_idx ON build (created_at DESC);