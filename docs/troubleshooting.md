# 트러블슈팅 기록

프로젝트 진행 중 마주친 문제와 해결 과정. 
각 항목은 증상 → 진단/원인 → 해결 순으로 정리.

## 인프라 (Hetzner)

### 1. Hetzner VPS(온프레미스 역할) 서버 선정 문제

증상: 초기에 싱가포르 리전 CX22급, 비슷한 라인업으로 하려 했는데 웹사이트에 없거나 비활성화 였음, CPX만 보임
원인: Hetzner가 2026년 라인업 개편 — CX 계열이 Cost-Optimized로 통합됐고 싱가포르엔 CPX/CAX만 존재, 심지어 다른 리전 Cost-Optimized 라인업은 일시적 비활성화 상태였음
해결: 리전/타입 트레이드오프 분석 후 유럽(Falkenstein) + CPX12 선택. (핑 좋은 미국은 트래픽 20TB→1TB 제한이라 배제) 이후 부족한 램 (2GB) 는 메모리 스왑으로 해결 결정, 메모리 스왑 기능 추가.

## 모니터링

### 1. 2GB 메모리 제약 (모니터링 스택 6개 컨테이너)

이슈: CPX12 2GB에 컨테이너 6개(app/db/nginx + 모니터링 3개) 운영
해결: 스왑 2GB 추가 + swappiness=10 + 컨테이너별 메모리 상한 지정. 결과 RAM 37%/스왑 5%로 안정

### 2. compose 볼륨 참조 오류
- 증상: `service "prometheus" refers to undefined volume`
- 원인: 서비스에서 참조한 볼륨명(prometheus)과 정의한 볼륨명(promdata) 불일치,
- 해결: 볼륨명 일치(prometheus -> promdata)

### 3. Grafana 대시보드 "No data" (Node Exporter Full, ID 1860)
- 증상: 대시보드는 열리는데 모든 패널이 No data / N/A
- 진단: Grafana Explore에서 `up` 쿼리 실행 → node, prometheus 두 타겟 모두
  값 1 확인. 즉 데이터 수집은 정상, 표시 단계 문제로 범위 좁힘
- 원인: 데이터소스를 실수로 중복 생성(prometheus, promethus-1, prometheus-2). 2에만 URL을 정확히 줘서 대시보드가
  URL이 비어있는 쪽(prometheus)을 참조하고 있었음
- 해결: URL이 올바른 데이터소스로 지정 → 정상 표시. 중복 데이터소스 삭제

- 교훈: 데이터가 없는 게 아니라 표시하는 단계에서 문제 발생 가능, 'up' 쿼리로 어느 계층에서 원인이 발생했는지 진단하는 것을 배움

### 4. SSH 터널 9090 Connection refused
- 증상: `ssh -L 9090:localhost:9090`로 Prometheus 접근 시도 시 연결 거부
- 원인: prometheus 서비스에 ports 매핑을 하지 않아 호스트에 9090 미노출
  (컨테이너 네트워크 내부에서만 접근 가능)
- 결론: 의도된 동작. Grafana는 컨테이너 네트워크로 prometheus:9090에 직접
  접근하므로 문제 없음. 관리 포트를 호스트에 노출하지 않는 것이 보안상 바람직

### 접근 방법

Grafana는 방화벽에 포트를 열지 않고 SSH 터널로만 접근 (관리 인터페이스 비노출):

## 자동화 (Ansible)

### 1. Ansible sudo 권한 오류

증상: sudo: interactive authentication is required
원인: become(sudo) 시 비밀번호 필요한데 미제공
해결: --ask-become-pass 추가

### 2. Ansible privilege escalation 타임아웃

증상: sudo 프롬프트 대기 중 12초 타임아웃
원인: sudo 프롬프트 처리 타이밍 문제
해결: deploy에 NOPASSWD sudo 설정 (SSH 키 인증 전제라 보안 영향 최소). 자동화 환경 표준 방식

### 3. Ansible ansible.cfg 무시됨

증상: world writable directory ... ignoring ansible.cfg
원인: 저장소가 윈도우 마운트(/mnt/c)에 있어 world-writable → Ansible이 보안상 cfg 무시
해결: 작업을 리눅스 홈(~)에서 수행. (WSL은 윈도우 파일시스템 접근이 느리고 권한 문제도 있음)

### 4. Ansible 멱등성 없는 명령 처리 (설계 고려사항)

이슈: fallocate/mkswap/swapon은 command라 반복 실행 시 문제
해결: stat으로 파일 존재 확인 → register → when 조건으로 "없을 때만 실행". 조건부 멱등성 구현

## 배포 & HTTPS

### 1. nginx 컨테이너 크래시

증상: 재배포 후 nginx가 목록에서 사라짐
원인: nginx 설정 문법 오류 (지시어 끝 세미콜론 누락)
해결: docker compose logs nginx의 [emerg] 로그로 위치 파악, 세미콜론 추가. (nginx -t로 사전 검증 가능)

### 2. HTTPS 접속 불가 (Connection refused)

증상: 컨테이너 Up인데 https 접속 거부, http만 됨
진단: 내부 접속 O, 방화벽 443 O, Cloud Firewall 없음 → curl https://도메인에서 Connection refused. 계층별로 좁힘
원인: git pull이 안 돼서 서버의 nginx 설정이 옛날 버전(443 미설정)
해결: 정상 pull 후 재배포

교훈: 모니터링 단계에서 3번 트러블 슈팅기록과 비슷, 내부 접속과 방화벽 443 허용 유무 확인 등을 통해 어느 계층별로 범위를 좁혀 문제를 진단하는 방식이 효과적임.

## 느낀 점
 프로젝트를 진행하면서 생긴 대부분의 문제들은 "증상만 보고 추측" 보다는 오류 로그(docker compose logs, Ansible 에러 메시지)또는 도구(up 쿼리, curl)를 활용해 계층별로 범위를 좁히는 것이 효과적인 방법이었다.