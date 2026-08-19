# 서버 초기 셋팅, 보안 하드닝

Hetzner VPS(Ubuntu 24.04) 첫 접속 후 진행하는 보안 설정 기록.

## 1. 첫 접속
```bash
ssh root@<서버IP>
```

##2. 시스템 업데이트
```bash
apt update && apt upgrade -y
```

## 3. 새 sudo 사용자 생성 (root 직접 사용 지양)
```bash
adduser deploy # 사용자 생성(비번 설정)
usermod -aG sudo deploy # sudo 권한 부여
```

## 4. SSH 키를 새 사용자에게 복사
```bash
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

## 5. SSH 보안 설정
/etc/ssh/sshd_config 편집:
- PermitRootLogin no (root 직접 로그인 차단)
- PasswordAuthentication no (비밀번호 로그인 차단, 키만 허용)

적용:
```bash
systemctl restart ssh
```

## 6. 방화벽 (ufw)
```bash
ufw allow OpenSSH # 22번 (SSH)
ufw allow 80/tcp # HTTP
ufw allow 443/tcp # HTTPS
ufw enable
```

## 7. fail2ban (무차별 대입 공격 차단)
```bash
apt install fail2ban -y
systemctl enable fail2ban
systemctl start fail2ban
```