# Node 20 슬림 이미지 기반
FROM node:20.20.2-slim

# 컨테이너 안 작업 폴더
WORKDIR /app

# 먼저 package 파일만 복사 (의존성 캐싱 최적화)
COPY package*.json ./

# 의존성 설치
RUN npm install

# 나머지 소스코드 전체 복사
COPY . .

#앱이 쓰는 포트 명시 (문서용)
EXPOSE 3000

# 컨테이너 시작 시 실행할 명령
CMD ["node", "index.js"]