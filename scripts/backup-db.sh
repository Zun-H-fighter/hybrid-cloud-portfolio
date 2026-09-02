#!/bin/bash
set -e

# 설정
BUCKET="zunfa-portfolio-backups-2026"
DB_CONTAINER="hybrid-cloud-portfolio-db-1"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="tododb_backup_${TIMESTAMP}.sql"
TMP_PATH="/tmp/${BACKUP_FILE}"

# 1. PostgreSQL 덤프 생성
docker exec "${DB_CONTAINER}" pg_dump -U todouser tododb > "${TMP_PATH}"

# 2. S3 업로드
aws s3 cp "${TMP_PATH}" "s3://${BUCKET}/backups/${BACKUP_FILE}"

# 3. 임시 파일 정리
rm -f "${TMP_PATH}"

echo "백업 완료: ${BACKUP_FILE}"