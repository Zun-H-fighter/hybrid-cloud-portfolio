# 모니터링 스택 구축 (페이즈 3)

Promethus + Node Exporter + Grafana를 Docker Compose로 배포.
CPX12 (2GB RAM) 제약 환경에서의 최적화

## 구성

| 컨테이너 | 역할 | 메모리 제한 |
|----------|------|------------|
| node-exporter | 호스트 시스템 메트릭 수집 (CPU/메모리/디스크) | 128M |
| prometheus | 메트릭 수집·저장 (시계열 DB) | 256M |
| grafana | 대시보드 시각화 | 256M |

데이터 흐름: Node Exporter(:9100) → Prometheus(:9090, 1분 주기 수집) → Grafana 대시보드

