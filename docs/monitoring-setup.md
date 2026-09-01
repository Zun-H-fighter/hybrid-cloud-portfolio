# 모니터링 스택 구축 (페이즈 3)

Promethus + Node Exporter + Grafana를 Docker Compose로 배포.
CPX12 (2GB RAM) 제약 환경에서의 최적화, 트러블 슈팅 기록

## 구성

| 컨테이너 | 역할 | 메모리 제한 |
|----------|------|------------|
| node-exporter | 호스트 시스템 메트릭 수집 (CPU/메모리/디스크) | 128M |
| prometheus | 메트릭 수집·저장 (시계열 DB) | 256M |
| grafana | 대시보드 시각화 | 256M |

데이터 흐름: Node Exporter(:9100) → Prometheus(:9090, 1분 주기 수집) → Grafana 대시보드

## 트러블슈팅 기록

### 1. compose 볼륨 참조 오류
- 증상: `service "prometheus" refers to undefined volume`
- 원인: 서비스에서 참조한 볼륨명(prometheus)과 정의한 볼륨명(promdata) 불일치,
- 해결: 볼륨명 일치(prometheus -> promdata)

### 2. Grafana 대시보드 "No data" (Node Exporter Full, ID 1860)
- 증상: 대시보드는 열리는데 모든 패널이 No data / N/A
- 진단: Grafana Explore에서 `up` 쿼리 실행 → node, prometheus 두 타겟 모두
  값 1 확인. 즉 데이터 수집은 정상, 표시 단계 문제로 범위 좁힘
- 원인: 데이터소스를 실수로 중복 생성(prometheus, promethus-1, prometheus-2). 2에만 URL을 정확히 줘서 대시보드가
  URL이 비어있는 쪽(prometheus)을 참조하고 있었음
- 해결: URL이 올바른 데이터소스로 지정 → 정상 표시. 중복 데이터소스 삭제

### 3. SSH 터널 9090 Connection refused
- 증상: `ssh -L 9090:localhost:9090`로 Prometheus 접근 시도 시 연결 거부
- 원인: prometheus 서비스에 ports 매핑을 하지 않아 호스트에 9090 미노출
  (컨테이너 네트워크 내부에서만 접근 가능)
- 결론: 의도된 동작. Grafana는 컨테이너 네트워크로 prometheus:9090에 직접
  접근하므로 문제 없음. 관리 포트를 호스트에 노출하지 않는 것이 보안상 바람직

## 접근 방법

Grafana는 방화벽에 포트를 열지 않고 SSH 터널로만 접근 (관리 인터페이스 비노출):
​```bash
ssh -L 3001:localhost:3001 deploy@<서버IP>
# 브라우저: http://localhost:3001
