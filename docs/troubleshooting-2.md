# 트러블 슈팅 2 - 2차 서비스 배포전 인프라 정비
```
2번째 서비스(다크소울 장비 최적화 app)을 같은 서버에 올리기 전 "이 사양으로 감당 가능?"을 검증하려다, 보안과 운영상의 문제가 연달아 드러나서 결과적으로 앱을 올리기전 인프라를 한바퀴 정비하게 됐다.
```
환경:Hetzner CPX12 (1 vCPU / 2 GB / 40 GB NVMe) · Docker Compose · Ubuntu
Claude와 검증하면서 해결했고 트러블슈팅 글 기록도 클로드 코드로 먼저 초안을 작성하고 그걸 참고삼아 기록했음.

---

## 0.발단 - 서버 사양 검증
이 프로젝트의 병목은 RAM이 아니라 단일 코어라는 전제가 여기서 잡혔다.

용량 자체는 문제없었다. 측정 결과 컨테이너 6개 합계 321.7 MiB, 전체 used 737 MiB 중 OS + dockerd/containerd 등이 415 MiB. available 1.1 GiB로 여유가 있었다. 앱 하나 추가로 늘어날 양은 75~115 MiB 수준.

최적화 연산량도 벤치마크했다. 방어구 4슬롯 조합을 완전탐색하면 DS1 규모(3.7 M 조합)에서 49.9 ms인데, 손·다리 슬롯을 미리 곱해 파레토 프론티어로 압축하면 2.27 ms로 떨어졌다 (1600쌍 → 9개). 완전탐색과 최적해가 정확히 일치하는 것도 확인했다. 근사가 아니다.

상세 수치는 별도 문서 참조.

---

## 1. Grafana가 인터넷에 노출
```yaml
    grafana:
    ports:
         - "3001:3000"                      # 0.0.0.0 바인딩
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
```
ufw는 22/80/443만 열어뒀으니 3001은 막혀 있다고 생각하고 있었다.

### 원인 — Docker는 ufw를 우회한다

Docker가 포트를 publish할 때 iptables의 nat / FORWARD 체인에 규칙을 직접 삽입한다. 반면 ufw는 INPUT 체인에서 필터링한다. 컨테이너로 향하는 트래픽은 INPUT이 아니라 FORWARD를 타기 때문에 ufw 규칙을 아예 만나지 않는다.

노트북(서버 외부)에서 확인:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 http://<서버IP>:3001/login
```
→ 응답이 왔다. 공개돼 있었다.
### 실제 위험도

다행히 초기 세팅 때 UI에서 admin 비밀번호를 이미 바꿔둔 상태였다. 즉 노출된 건 "admin/admin으로 열린 관리자 콘솔"이 아니라 "로그인 페이지가 공개된 것" 이었다. Grafana는 익명 접근이 기본 꺼짐이고 로그인 브루트포스 보호도 기본 켜짐이라, 실제 침입 경로는 제한적이었다.

침입 흔적 점검: 사용자 목록, 서비스 계정, API 키, 데이터소스 — 모두 깨끗했다.

다만 `GF_SECURITY_ADMIN_PASSWORD: admin`이 남아 있는 건 지뢰였다. 이 값은 최초 init 때만 적용되므로 지금은 무해하지만, `grafanadata` 볼륨을 지우고 재구축하는 순간 `admin/admin`으로 되살아난다.
### 조치

```yaml
  grafana:
    ports:
      - "127.0.0.1:3001:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?set in .env}
```
접속은 SSH 터널로: `ssh -L 3001:127.0.0.1:3001 deploy@<서버IP>`
### 배운 것
>**`ports:`에 `127.0.0.1:`이 없으면 인터넷 공개임. ufw로는 못 막음.**

공개할 것은 nginx의 80/443뿐이고, 나머지는 전부 루프백 바인딩 + 리버스 프록시로 간다. Prometheus는 애초에 `ports:`가 없어서 도커 네트워크 내부에만 있었다 — 그건 올바른 구성이었다.

---

## 2. `latest` 태그가 메이저 버전을 갈아치웠다
 
### 증상
 
Grafana 비밀번호를 CLI로 바꾸려는데:
 
```
OCI runtime exec failed: exec: "grafana-cli": executable file not found in $PATH
```
 
### 원인
 
`grafana/grafana:latest` 를 쓰고 있었고, 어느 시점의 `docker compose pull`에서
**메이저 버전이 통째로 올라가 있었다.** 확인해보니 v13.2.0.
최근 버전은 `grafana-cli`가 통합 바이너리의 서브커맨드로 바뀌어 있었다.
 
문제는 CLI 문법이 아니다. **내가 모르는 사이에 메이저 버전이 바뀌어 있었다는 것**이다.
대시보드가 조용히 깨졌어도 몰랐을 상황이다.
 
### 조치
 
돌고 있던 버전을 전부 확인해서 고정했다.
 
```yaml
  db:            { image: postgres:16.15 }
  nginx:         { image: nginx:1.31.4-alpine }
  node-exporter: { image: prom/node-exporter:v1.12.1 }
  prometheus:    { image: prom/prometheus:v3.14.0 }
  grafana:       { image: grafana/grafana:13.2.0 }
```
`app/Dockerfile` 도 `FROM node:20-slim` → `FROM node:20.20.2-slim`.
 
비밀번호 변경은 버전에 의존하지 않는 HTTP API로 처리했다.
 
### 배운 것
 
> **테스트 자동화가 없는 환경에서 "언제 뭐가 바뀌었는지 모르는 것"이 가장 비싸다.**
 
패치 자리까지 고정하고, 업데이트는 의식적으로 한다.
추후 Renovate를 붙여 고정은 유지하면서 업데이트 PR을 자동 생성하도록 할 예정.
(Dependabot은 docker-compose를 보지 않는다.)
 
---
 
## 3. `.env` 전환 후 DB 인증이 실패했다 — 그리고 검증이 헛돌았다
 
이번 정비에서 **가장 오래 걸린 문제**이고, 배운 것도 가장 많다.
 
### 증상
 
자격증명을 compose 하드코딩에서 `.env`로 분리한 뒤:
 
```
error: password authentication failed for user "todouser"
  code: '28P01'
  at async initDB (/app/index.js:11:5)
```
 
### 첫 번째 함정 — `POSTGRES_PASSWORD`는 최초 init 때만 적용된다
 
`.env`를 바꾸고 컨테이너를 재생성하면 DB 비밀번호도 바뀔 거라고 생각했다. **아니다.**
 
Postgres 공식 이미지의 `POSTGRES_PASSWORD`는 **데이터 디렉터리가 비어 있을 때(최초 초기화)만** 사용된다.
이미 초기화된 볼륨에서는 완전히 무시된다.
즉 `docker compose config`에서 db와 app이 같은 값으로 보여도,
**DB에 실제 저장된 비밀번호와는 아무 상관이 없다.**
 
실제 비밀번호를 바꾸려면 `ALTER USER` 또는 psql의 `\password` 를 직접 실행해야 한다.
 
### 두 번째 함정 — 검증 명령이 비밀번호를 검사하지 않고 있었다
 
비밀번호가 맞는지 확인하려고 이렇게 테스트했다:
 
```bash
docker compose exec db psql -h 127.0.0.1 -U todouser -d tododb -c "select 1"
```
 
성공했다. 그런데 앱은 계속 실패했다. 몇 번을 돌려도 같았다.
 
**대조군을 넣어보니 원인이 드러났다.** 일부러 틀린 비밀번호로:
 
```bash
docker compose exec -T -e PGPASSWORD='completely-wrong-xyz123' db \
  psql -h 127.0.0.1 -U todouser -d tododb -c "select 1"
```
 
→ **이것도 통과했다.**
 
`pg_hba.conf`를 확인:
 
```
local   all  all              trust            # 유닉스 소켓
host    all  all  127.0.0.1/32  trust          # ← 여기서 통과하고 있었다
host    all  all  ::1/128       trust
host    all  all  all           scram-sha-256  # ← 앱이 걸리는 규칙
```
 
컨테이너 **안에서 자기 자신에게** 붙으면 `trust`라 비밀번호를 아예 보지 않는다.
도커 네트워크를 건너오는 앱만 실제 인증을 받는다.
내 테스트는 처음부터 다른 규칙을 타고 있었던 것이다.
 
### 조치
 
앱과 같은 경로(`-h db`)로 테스트하도록 바꾸고, 대조군을 항상 함께 돌렸다.
비밀번호는 "알아내서 맞추는" 게 아니라 **"덮어써서 맞추는"** 방식으로 해결했다
(Postgres는 SCRAM-SHA-256 해시만 저장하므로 원본을 꺼낼 방법이 없다).
 
`.env` 값을 그대로 밀어넣어 오타 가능성을 제거:
```bash
set -a; . ./.env; set +a
printf "ALTER USER todouser WITH PASSWORD :'pw';\n" \
  | docker compose exec -T db psql -U todouser -d tododb -v pw="$DB_PASSWORD" -f -
```
 
> psql의 `:'pw'` 변수 치환은 `-c` 옵션에서는 동작하지 않는다.
> 파일 또는 표준입력(`-f`)으로 넘겨야 한다. 이것도 한 번 밟았다.
 
### 세 번째 — 앱 코드가 환경변수를 읽지 않고 있었다
 
`grep`으로 확인하니 `app/db.js`에 비밀번호가 하드코딩돼 있었다.
`.env`를 아무리 고쳐도 소용이 없는 상태였다.
 
```js
// 필수 환경변수 검증 — 조용히 틀린 값으로 붙지 말고 즉시 죽는다
for (const key of ["DB_USER", "DB_PASSWORD", "DB_NAME"]) {
  if (!process.env[key]) throw new Error(`환경변수 ${key} 가 설정되지 않았습니다`);
}
 
const pool = new Pool({
  host:     process.env.DB_HOST || "db",
  port:     Number(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
```
 
`process.env.DB_PASSWORD || "todopass"` 같은 **폴백을 넣지 않은 것이 핵심**이다.
폴백이 있으면 환경변수가 빠졌을 때 조용히 옛날 값으로 접속을 시도하다가,
정확히 이번과 같은 상황이 재발한다.
compose에서 `${DB_PASSWORD:?set in .env}` 를 쓴 것과 같은 원칙 — **틀렸으면 시끄럽게 죽는다.**
 
### 배운 것
 
> **테스트가 성공했을 때, 그 테스트가 실제로 검증하려던 것을 검증했는지 대조군으로 확인해야 한다.**
 
"성공했으니 맞다"가 아니라 "실패해야 할 때 실패하는가"를 같이 봐야 한다.
이번에는 대조군 한 줄이 몇 시간을 줄였다. 인프라 디버깅에서 계속 쓰게 될 습관이다.
 
부수적으로 배운 것:
- 환경변수가 컨테이너에 반영되려면 **재생성**이 필요하다. `docker compose restart`는 환경변수를 다시 읽지 않는다 (`up -d --force-recreate`)
- `docker compose config`는 "설정 파일 해석 결과"일 뿐, 돌고 있는 컨테이너의 실제 값이 아니다. 실제 값은 `docker inspect`로 본다
---
 
## 4. 1 vCPU에서 빌드와 컨테이너 교체가 충돌했다
 
### 증상
 
배포 중:
```
Error response from daemon: removal of container 9ac37d7acc1c... is already in progress
```
일부 컨테이너만 올라오고 나머지는 죽은 상태로 멈췄다.
 
### 원인
 
`docker compose up -d --build` 는 빌드와 컨테이너 교체를 **동시에** 진행한다.
1 vCPU에서 이 둘이 경합하면 이전 컨테이너의 삭제가 끝나기 전에 새 명령이 같은 컨테이너를 또 지우려 하면서 레이스가 난다.
 
근거가 될 만한 흔적이 이미 있었다:
 
| 증거 | 값 | 의미 |
|---|---|---|
| `docker system df` Build Cache | 304.4 MB / 12개 | 서버에서 빌드해 온 직접 증거 |
| `free -h` Swap 사용 | 132.6 MB | `available`이 1.1 GiB인데도 스왑됨 = 과거 메모리 압박 |
 
swapfile을 미리 만들어둔 덕에 OOM 없이 넘어갔지만, 이건 *살아남았다*이지 *괜찮다*가 아니다.
 
### 조치
 
즉시 조치는 빌드와 교체를 분리:
```bash
docker compose build      # 빌드만, 기존 컨테이너는 계속 동작
docker compose up -d      # 다 만들어진 뒤 교체
```
 
근본 조치는 **빌드를 서버에서 들어내는 것**. 별도 문서로 정리했다.
GitHub Actions에서 빌드 → GHCR push → 서버는 `docker compose pull` 만 수행하도록 전환했다.
이미지 태그는 커밋 SHA(`sha-abc1234`)로 박아, 배포된 것이 어느 커밋인지 확정되고
롤백이 `.env`의 `APP_TAG` 한 줄 수정으로 끝나게 했다.
 
빌드 캐시 304 MB도 회수했다.
 
### 배운 것
 
> **제약이 있으면 구조로 푼다.** 1 vCPU에서 빌드를 하지 않으면 되는 문제였다.
 
---
 
## 5. 배포 서버가 git 브랜치를 분기시켰다
 
### 증상
 
CD의 배포 단계에서:
```
hint: Diverging branches can't be fast-forwarded
fatal: Not possible to fast-forward, aborting.
```
 
### 원인
 
서버에서 compose를 직접 수정하고 커밋한 적이 있었다.
그 결과 서버의 `main`에 원격에 없는 커밋이 생겨 분기됐다.
 
### 조치
 
서버에만 있는 커밋을 확인하고(백업 브랜치를 먼저 만들어 안전망 확보), origin에 정렬:
 
```bash
git branch backup-server-$(date +%Y%m%d)   # 안전망
git fetch origin
git reset --hard origin/main
```
 
`.env`는 gitignore 대상이라 `reset --hard`로도 지워지지 않는다.
 
배포 스크립트도 `git pull --ff-only` → `git fetch origin && git reset --hard origin/main` 으로 변경했다.
**배포 대상 서버는 origin의 거울이어야 한다.** 로컬 상태를 갖고 있으면 안 되고,
"지금 서버에 뭐가 있는지"가 커밋 해시 하나로 확정돼야 한다.
 
### 배운 것
 
> **서버에서는 커밋하지 않는다.** 편집은 로컬 → push → 서버는 받기만.
 
참고로 이 서버에는 GitHub 푸시 자격증명을 두지 않았는데, 이게 오히려 올바른 구성이다.
서버가 침해돼도 repo에 악성 커밋을 올릴 수 없고, 이번 같은 분기가 구조적으로 생기지 않는다.
 
---
 
## 6. 워크플로 작성 중 겪은 문법 함정들
 
짧지만 반복해서 밟은 것들.
 
**YAML 블록 스칼라 들여쓰기**
```
yaml.scanner.ScannerError: while scanning a simple key
  line 20, column 9 — could not find expected ':'
```
`run: |` 아래 내용이 `run:` 보다 **더 깊게** 들여쓰기 되어야 한다.
같은 깊이면 YAML이 문자열이 아니라 새 키로 읽고, `echo ...` 에는 콜론이 없어서 이 에러가 난다.
 
`python3 -c "import yaml; yaml.safe_load(open('...'))"` 로 푸시 전에 검증하는 습관을 들였다.
 
**Actions 표현식 vs 셸 환경변수**
 
| 문법 | 정체 | 쓰는 곳 |
|---|---|---|
| `${{ github.repository }}` | Actions 표현식, YAML 파싱 시 치환 | 어디든 |
| `$GITHUB_REPOSITORY` | 셸 환경변수 | `run:` 블록 안 |
 
소문자 변환(`${VAR,,}`)은 bash 문법이라 셸 변수에만 적용된다.
GHCR은 대문자가 든 이미지 이름을 거부하는데 내 계정명에 대문자가 있어서 필요했다.
 
**`appleboy/ssh-action` vs `scp-action`**
`Unexpected input(s) 'script'` 경고가 떴는데, 유효 입력 목록에 `source`/`target`/`tar_*`가 있었다.
파일 전송용 입력 = `scp-action`을 쓰고 있었던 것.
 
결국 서드파티 액션 없이 순수 `ssh`로 바꿨다.
**배포용 SSH 개인키를 통째로 넘기는 자리**라 의존성을 줄이는 편이 낫다고 판단했다.
 
**셸 줄 연속 문자 `\`**
여러 줄 명령을 한 줄로 붙여넣으면서 `\`를 남겨두면, 뒤따르는 공백이 이스케이프되어
`" -c"` 같은 **공백으로 시작하는 인자**가 만들어진다.
한 줄로 쓸 때는 `\`를 반드시 제거한다.
 
**`branches` 오타로 모든 브랜치에서 배포가 돌고 있었다**
```yaml
on:
  push:
    braches: [ main ]     # branches 오타
```
Actions가 모르는 키를 무시하면서 `push:` 가 **빈 필터**가 됐다.
즉 어느 브랜치에 push해도 프로덕션 배포가 나가는 상태였다.
문법 에러가 아니라 **조용히 의미가 바뀌는** 유형이라 더 위험하다.
 
**ssh 명령의 경계**
`git pull --ff-only` 를 `git fetch && git reset --hard` 로 바꾸면서,
새 명령을 ssh 문자열 **바깥**에 별도 줄로 넣었다.
그러면 서버가 아니라 GitHub 러너에서 실행된다.
deploy job에는 `actions/checkout` 이 없어 러너에 repo 자체가 없으므로,
**ssh는 성공했는데 스텝은 실패**로 표시된다.
 
> 큰따옴표 안이 서버에서 실행될 전부다. 바깥에 쓴 것은 러너에서 돈다.
 
---
 
## 7. 오프로드가 이미 무력화되어 있었다 — 그리고 CI 게이트로 고정했다
 
4번에서 빌드를 CI로 옮겼는데, repo 전체를 다시 훑어보다 **그게 동작하지 않고 있다**는 것을 발견했다.
 
### 증상
 
`docker-compose.yml` 에는 분명히 이렇게 되어 있었다.
```yaml
  app:
    image: ghcr.io/zun-h-fighter/hybrid-cloud-portfolio-app:${APP_TAG:?set in .env}
```
 
그런데 **`docker-compose.override.yml` 이 repo에 커밋되어 있었고**, 그 안에 `build: ./app` 이 있었다.
 
Docker Compose는 `docker-compose.override.yml` 을 **자동으로 병합**한다.
서버가 `git pull` 로 이 파일을 받으면 `image:` 를 덮어쓰고 다시 빌드한다.
**오프로드 작업이 통째로 되돌려진 상태였다.**
 
### 원인
 
`.gitignore` 의 마지막 줄이 이랬다.
```
.docker-compose.override.yml     ← 앞에 점이 붙은 오타
```
 
무시되지 않으니 커밋됐고, 커밋됐으니 서버로 전파됐다.
게다가 override 파일이 **전체 설정의 복사본**이라, 이후 `docker-compose.yml` 을 고쳐도
override가 덮어쓰는 구간은 반영되지 않는 상태였다.
원래 override는 *차이만* 담아야 한다.
 
### 조치
 
```bash
git rm --cached docker-compose.override.yml
# .gitignore 오타 수정 (점 제거)
```
override는 로컬 개발용 최소 내용만 남겼다.
```yaml
services:
  app:
    build: ./app
    image: hybrid-cloud-portfolio-app:dev
```
 
> **`git rm --cached` 는 추적만 해제하고 워킹트리의 파일은 남긴다.**
> 서버에서는 별도로 `rm` 해야 했다. 이제 gitignore 대상이라 `git reset --hard` 로도 지워지지 않는다.
 
### 재발 방지 — CI 게이트
 
여기서 멈추면 같은 실수가 또 들어올 수 있다. CI가 막도록 했다.
 
```yaml
      - name: 배포용 compose에 build 가 없는지 확인
        run: |
          if docker compose config | grep -q "build:"; then
            echo "::error::배포용 compose에 build: 가 있습니다. 서버가 이미지를 직접 빌드하게 됩니다."
            exit 1
          fi
```
 
기존 `ci.yml` 은 `docker build ./app` 을 한 번 더 돌리고 있었는데,
deploy 워크플로가 어차피 같은 이미지를 빌드하므로 완전한 중복이었다.
**빌드를 반복하는 대신, deploy가 검증하지 않는 것을 검증하도록** 전부 교체했다.
 
| 스텝 | 잡는 것 |
|---|---|
| 워크플로 YAML 문법 검증 | 6번에서 세 번 밟은 들여쓰기·키 위치 오류 |
| `docker compose config --quiet` | compose 문법 오류, 변수 누락 |
| `build:` 존재 여부 | 이번 override 사고의 회귀 |
| GHCR 이미지 참조 여부 | "빌드 안 함"과 "레지스트리에서 받음"은 다른 조건이므로 둘 다 확인 |
 
푸시 전에 override에 `build: ./app` 을 다시 넣어보고 CI가 실제로 실패하는지 확인했다.
**가드는 실패하는 것을 본 뒤에야 가드다.** 3번에서 배운 대조군 원칙을 그대로 적용했다.
 
### 배운 것
 
> **고쳤다고 끝이 아니다. 되돌아오지 못하게 막아야 끝이다.**
 
그리고 이 사고는 3번과 같은 형태다 — **설정이 의도대로 적용되고 있는지를 확인하지 않았다.**
`docker-compose.yml` 을 고쳤으니 됐다고 생각했지만,
실제로 적용되는 값은 `docker compose config` 의 출력이지 내가 편집한 파일이 아니다.
 
---
 
## 이번에 세운 원칙
 
| 원칙 | 이유 |
|---|---|
| `ports:`에 `127.0.0.1:`이 없으면 인터넷 공개다 | ufw는 Docker publish 포트를 막지 못한다 |
| 이미지 태그는 패치 자리까지 고정한다 | 모르는 사이 바뀌는 것이 가장 비싸다 |
| 자격증명은 `.env`, 없으면 시끄럽게 죽는다 | 폴백은 조용한 오작동을 만든다 |
| 테스트에는 대조군을 함께 돌린다 | 성공이 무엇을 증명하는지 확인해야 한다 |
| 서버는 origin의 거울, 커밋하지 않는다 | 배포 상태가 커밋 해시로 확정돼야 한다 |
| 빌드는 서버에서 하지 않는다 | 1 vCPU에서 구조적으로 감당이 안 된다 |
| 편집한 파일이 아니라 **실제 적용된 설정**을 확인한다 | `docker compose config`, `docker inspect` 가 진실이다 |
| 고친 것은 CI 게이트로 고정한다 | 고친 것은 되돌아온다 |
 
## 정비 결과
 
- Grafana 공개 노출 차단 (루프백 바인딩 + SSH 터널)
- 자격증명 `.env` 분리, DB 비밀번호 교체, `.env.example` 제공
- 이미지 6종 전체 버전 고정 + app 베이스 이미지 고정
- 컨테이너 메모리 상한 설정 (기존에 상한이 없던 app / db / nginx 포함)
- `restart: unless-stopped` 누락분 보완
- Prometheus 보존정책 명시 (`retention.time=15d`, `retention.size=4GB`)
- 빌드를 GitHub Actions + GHCR로 오프로드, 서버는 pull 전용으로 전환
- 커밋되어 있던 `docker-compose.override.yml` 추적 해제 (오프로드 무력화 해소)
- 배포 트리거를 `main` 브랜치로 한정 (`branches` 오타로 전 브랜치 배포되던 것)
- `ci.yml` 을 중복 빌드에서 설정 검증 + 회귀 가드로 교체
- 빌드 캐시 304 MB 회수
두 번째 앱을 올리기 전에 이 정비를 먼저 한 것이 결과적으로 맞는 순서였다.
 
## 돌아보며
 
이번에 오래 걸린 문제들은 **문법 오류가 아니라 "확인했다고 생각했는데 확인하지 않은 것"** 이었다.
 
- 3번: 테스트가 통과했지만 `trust` 규칙을 타고 있어서 비밀번호를 검사하지 않았다
- 7번: `docker-compose.yml` 을 고쳤지만 override가 덮어쓰고 있었다
- 6번: `braches` 오타는 에러를 내지 않고 조용히 의미만 바꿨다
세 개 모두 **"내가 편집한 것"과 "실제로 동작하는 것"이 다른** 경우다.
문법 오류는 즉시 터지므로 오히려 싸다. 비싼 것은 조용히 어긋나 있는 쪽이다.
 
그래서 습관 두 개를 챙겼다 —
**대조군을 함께 돌린다**(실패해야 할 때 실패하는가),
**적용된 설정을 출력해서 본다**(`docker compose config`, `docker inspect`).